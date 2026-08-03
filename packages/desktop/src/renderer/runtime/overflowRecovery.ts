// Suppresses the transient error pi emits on context overflow (A-42).
//
// On overflow the SDK sends an assistant message with `stopReason: "error"`,
// then `agent_end { willRetry: false }` — and only AFTER that recovers on its
// own: `compaction_start { reason: "overflow" }` → summarize → `compaction_end
// { willRetry: true }` → continue the run on the compacted context. The SDK
// even strips the errored message from its own state before retrying; only the
// UI would show it. So we hold exactly that message (and its `agent_end`, which
// keeps the thread visibly running through the 30s+ compaction) until the
// stream tells us which way it went:
//
// - compaction succeeded and the run continued → drop the held events; the
//   user never sees an error, just the "Compacting conversation" step.
// - compaction failed / never started / the child died → replay the held
//   events so the normal error bubble shows (with pi's friendlier recovery
//   message when it sent one).
//
// Real (non-overflow) errors never match the pattern check and are never
// delayed. `agent_settled` (pi ≥ 0.80.4, "run fully settled incl. compaction
// and retry") is handled as a flush trigger already; on the pinned 0.79.8 it
// never fires, so ~10s timers are the fallback decision points.

import type { SessionAgentEvent } from "../rpc/types";
import { isOverflowErrorMessage } from "./overflowPatterns";
import { addPendingCompactionMarker, takePendingCompactionMarkers } from "./pendingCompaction";

type MessageEndEvent = Extract<SessionAgentEvent, { type: "message_end" }>;

/** Renderer-side mirror of a session's compaction state, kept because react-pi
 *  drops its live subscription ~30s after a thread unmounts and snapshots do
 *  not carry compaction — `electronPiClient.subscribe()` re-syncs from this. */
export interface CompactionMirror {
  active: boolean;
  reason?: "manual" | "threshold" | "overflow";
  everCompacted: boolean;
}

interface Hold {
  /** recovery-pending: waiting to learn whether compaction handles the error.
   *  continuation-pending: compaction succeeded, waiting for the retry run. */
  phase: "recovery-pending" | "continuation-pending";
  messageEnd: MessageEndEvent;
  agentEnd?: SessionAgentEvent;
  timer?: ReturnType<typeof setTimeout>;
}

/** Events that prove the run is (still) executing — in continuation-pending
 *  they confirm the post-compaction retry took over. `message_end` and
 *  `agent_end` are handled separately. */
const RUN_ACTIVITY = new Set([
  "agent_start",
  "turn_start",
  "message_start",
  "message_update",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
]);

const isOverflowErrorEnd = (e: SessionAgentEvent): boolean => {
  if (e.type !== "message_end") return false;
  const m = e.message;
  if (m?.role !== "assistant" || m.stopReason !== "error" || typeof m.errorMessage !== "string") return false;
  return isOverflowErrorMessage(m.errorMessage);
};

export class OverflowRecoveryInterceptor {
  private readonly holds = new Map<string, Hold>();
  private readonly compactions = new Map<string, CompactionMirror>();

  constructor(
    private readonly emit: (e: SessionAgentEvent) => void,
    private readonly holdTimeoutMs = 10_000,
  ) {}

  /** Route every fan-out-bound stream event through here. */
  process(e: SessionAgentEvent): void {
    this.trackCompaction(e);
    // A new user prompt starts a new turn: assistant-ui re-anchors the
    // viewport anyway, so this is the one moment the parked compaction
    // markers can enter the transcript without making the thread jump.
    if (e.type === "message_start" && e.message?.role === "user") {
      this.injectPendingMarkers(e.sessionPath);
    }
    const hold = this.holds.get(e.sessionPath);
    if (e.type === "compaction_end") {
      this.handleCompactionEnd(e, hold);
      return;
    }
    if (!hold) {
      if (e.type === "message_end" && isOverflowErrorEnd(e)) {
        this.beginHold(e);
        return;
      }
      this.emit(e);
      return;
    }
    switch (e.type) {
      case "agent_end":
        if (hold.phase === "recovery-pending") {
          hold.agentEnd = e;
          return;
        }
        // continuation-pending: the run ended without any activity — give up.
        this.replayHeld(e.sessionPath);
        this.emit(e);
        return;
      case "compaction_start":
        // The decision point moves to compaction_end, which pi always emits.
        if (hold.phase === "recovery-pending") this.clearTimer(hold);
        this.emit(e);
        return;
      case "agent_settled":
        // Run fully settled without the continuation consuming the hold.
        this.replayHeld(e.sessionPath);
        this.emit(e);
        return;
      case "message_end":
        if (isOverflowErrorEnd(e)) {
          this.replayHeld(e.sessionPath);
          this.beginHold(e);
          return;
        }
        this.settleOnActivity(hold, e.sessionPath);
        this.emit(e);
        return;
      default:
        if (RUN_ACTIVITY.has(e.type)) this.settleOnActivity(hold, e.sessionPath);
        this.emit(e);
        return;
    }
  }

  /** Replay anything held for the session (used on child crash, before the
   *  bridge notifies error listeners, so the error lands on the message). */
  flush(sessionPath: string): void {
    this.replayHeld(sessionPath);
  }

  private handleCompactionEnd(e: Extract<SessionAgentEvent, { type: "compaction_end" }>, hold: Hold | undefined): void {
    this.emit(e);
    if (hold?.phase === "recovery-pending") {
      if (e.willRetry === true && !e.aborted && e.errorMessage === undefined) {
        hold.phase = "continuation-pending";
        this.armTimer(hold, e.sessionPath);
      } else {
        // Failed / aborted / won't retry — surface the error, preferring
        // pi's actionable recovery message over the raw provider text.
        this.replayHeld(e.sessionPath, e.errorMessage);
      }
    }
    // Park the permanent trace instead of injecting it now: a transcript
    // message appended here would break assistant-ui's [user, assistant]
    // turn-anchor tail and collapse the reserved space under the divider
    // (the thread would visibly jump). The in-message divider shows the
    // settled state in place; injectPendingMarkers() delivers the transcript
    // marker with the next user prompt. pi writes the same entry to the
    // session file, so reloads show it regardless.
    if (e.aborted || e.errorMessage !== undefined || typeof e.result?.summary !== "string") return;
    const { summary, tokensBefore } = e.result;
    addPendingCompactionMarker(e.sessionPath, { summary, tokensBefore, timestamp: Date.now() });
  }

  private injectPendingMarkers(sessionPath: string): void {
    for (const marker of takePendingCompactionMarkers(sessionPath)) {
      this.emit({
        type: "message_start",
        message: { role: "compactionSummary", ...marker },
        sessionPath,
      });
    }
  }

  compactionState(sessionPath: string): CompactionMirror | undefined {
    return this.compactions.get(sessionPath);
  }

  private trackCompaction(e: SessionAgentEvent): void {
    if (e.type === "compaction_start") {
      this.compactions.set(e.sessionPath, { active: true, reason: e.reason, everCompacted: true });
    } else if (e.type === "compaction_end") {
      this.compactions.set(e.sessionPath, { active: false, reason: e.reason, everCompacted: true });
    }
  }

  /** Run activity while holding: expected in continuation-pending (the retry
   *  arrived — drop the held error), unexpected in recovery-pending (no
   *  compaction is coming — surface it). */
  private settleOnActivity(hold: Hold, sessionPath: string): void {
    if (hold.phase === "continuation-pending") this.discardHeld(sessionPath);
    else this.replayHeld(sessionPath);
  }

  private beginHold(e: MessageEndEvent): void {
    const hold: Hold = { phase: "recovery-pending", messageEnd: e };
    this.holds.set(e.sessionPath, hold);
    this.armTimer(hold, e.sessionPath);
  }

  private armTimer(hold: Hold, sessionPath: string): void {
    this.clearTimer(hold);
    hold.timer = setTimeout(() => this.replayHeld(sessionPath), this.holdTimeoutMs);
  }

  private clearTimer(hold: Hold): void {
    if (hold.timer !== undefined) clearTimeout(hold.timer);
    hold.timer = undefined;
  }

  private discardHeld(sessionPath: string): void {
    const hold = this.holds.get(sessionPath);
    if (!hold) return;
    this.clearTimer(hold);
    this.holds.delete(sessionPath);
  }

  private replayHeld(sessionPath: string, overrideError?: string): void {
    const hold = this.holds.get(sessionPath);
    if (!hold) return;
    this.clearTimer(hold);
    this.holds.delete(sessionPath);
    const message = overrideError
      ? { ...hold.messageEnd.message, errorMessage: overrideError }
      : hold.messageEnd.message;
    // The synthetic message_start makes the replay land even if a snapshot
    // arrived mid-hold and cleared the reducer's streaming slot (a message_end
    // without an open slot is silently dropped). If no snapshot intervened it
    // adds an empty assistant entry that group-merge renders invisibly and the
    // next snapshot removes.
    this.emit({ type: "message_start", message, sessionPath });
    this.emit({ ...hold.messageEnd, message });
    if (hold.agentEnd) this.emit(hold.agentEnd);
  }
}
