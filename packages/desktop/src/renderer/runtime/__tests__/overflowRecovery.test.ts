import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionAgentEvent } from "../../rpc/types";
import { OverflowRecoveryInterceptor } from "../overflowRecovery";
import { getPendingCompactionMarkers, resetPendingCompactionMarkers } from "../pendingCompaction";

// The interceptor is a pure state machine over the sidecar event stream: it
// holds pi's transient context-overflow error until the stream shows whether
// auto-compaction recovered (drop) or not (replay). Tests drive it with the
// exact event sequences the pi SDK emits (verified against agent-session.js).

const A = "/ws/sessions/a.jsonl";
const B = "/ws/sessions/b.jsonl";

/** Anthropic's real overflow error text — matches pi's overflow patterns. */
const OVERFLOW_TEXT = "prompt is too long: 213462 tokens > 200000 maximum";

const overflowMessage = {
  role: "assistant",
  content: [],
  stopReason: "error",
  errorMessage: OVERFLOW_TEXT,
};

const ev = (type: string, extra: Record<string, unknown> = {}, sessionPath = A) =>
  ({ type, ...extra, sessionPath }) as SessionAgentEvent;

const overflowEnd = (sessionPath = A) => ev("message_end", { message: overflowMessage }, sessionPath);
const agentEnd = (sessionPath = A) => ev("agent_end", { willRetry: false }, sessionPath);
const compactionStart = (reason = "overflow") => ev("compaction_start", { reason });
const compactionEnd = (over: Record<string, unknown> = {}) =>
  ev("compaction_end", { reason: "overflow", aborted: false, willRetry: true, ...over });

let emitted: SessionAgentEvent[];
let interceptor: OverflowRecoveryInterceptor;

const types = () => emitted.map((e) => e.type);

beforeEach(() => {
  vi.useFakeTimers();
  resetPendingCompactionMarkers();
  emitted = [];
  interceptor = new OverflowRecoveryInterceptor((e) => emitted.push(e));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OverflowRecoveryInterceptor", () => {
  describe("passthrough (no hold)", () => {
    it("should pass a non-overflow error message_end through untouched", () => {
      const e = ev("message_end", {
        message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Internal server error" },
      });
      interceptor.process(e);
      expect(emitted).toEqual([e]);
    });

    it("should pass a rate-limit error through untouched (non-overflow pattern exclusion)", () => {
      const e = ev("message_end", {
        message: { role: "assistant", content: [], stopReason: "error", errorMessage: "rate limit exceeded" },
      });
      interceptor.process(e);
      expect(emitted).toEqual([e]);
    });

    it("should pass a successful assistant message_end through untouched", () => {
      const e = ev("message_end", { message: { role: "assistant", content: [], stopReason: "stop" } });
      interceptor.process(e);
      expect(emitted).toEqual([e]);
    });

    it("should pass ordinary run events through untouched", () => {
      for (const e of [ev("agent_start"), ev("turn_start"), ev("turn_end"), agentEnd()]) interceptor.process(e);
      expect(types()).toEqual(["agent_start", "turn_start", "turn_end", "agent_end"]);
    });
  });

  describe("holding an overflow error", () => {
    it("should suppress the overflow message_end and the following agent_end", () => {
      interceptor.process(overflowEnd());
      interceptor.process(agentEnd());
      expect(emitted).toHaveLength(0);
    });

    it("should pass turn_end through while holding", () => {
      interceptor.process(overflowEnd());
      interceptor.process(ev("turn_end"));
      interceptor.process(agentEnd());
      expect(types()).toEqual(["turn_end"]);
    });

    it("should pass compaction_start through while keeping the hold", () => {
      interceptor.process(overflowEnd());
      interceptor.process(agentEnd());
      interceptor.process(compactionStart());
      expect(types()).toEqual(["compaction_start"]);
    });
  });

  describe("successful recovery", () => {
    const runRecovery = () => {
      interceptor.process(overflowEnd());
      interceptor.process(ev("turn_end"));
      interceptor.process(agentEnd());
      interceptor.process(compactionStart());
      interceptor.process(compactionEnd());
    };

    it("should drop the held error for good when the retry run starts", () => {
      runRecovery();
      interceptor.process(ev("agent_start"));
      interceptor.process(ev("turn_start"));
      expect(types()).toEqual(["turn_end", "compaction_start", "compaction_end", "agent_start", "turn_start"]);
    });

    it("should not replay after the retry consumed the hold even when the timer elapses", () => {
      runRecovery();
      interceptor.process(ev("agent_start"));
      vi.advanceTimersByTime(60_000);
      expect(types()).toEqual(["turn_end", "compaction_start", "compaction_end", "agent_start"]);
    });

    it("should not let the recovery-pending timer fire during a slow compaction", () => {
      interceptor.process(overflowEnd());
      interceptor.process(agentEnd());
      interceptor.process(compactionStart());
      vi.advanceTimersByTime(60_000); // summarization can take arbitrarily long
      expect(types()).toEqual(["compaction_start"]);
    });

    it("should replay when compaction succeeded but no continuation ever arrived", () => {
      runRecovery();
      vi.advanceTimersByTime(10_000);
      expect(types()).toEqual([
        "turn_end",
        "compaction_start",
        "compaction_end",
        "message_start",
        "message_end",
        "agent_end",
      ]);
    });

    it("should give up and replay when the run ends again instead of continuing", () => {
      runRecovery();
      interceptor.process(agentEnd()); // continuation never started; the run just ended
      expect(types()).toEqual([
        "turn_end",
        "compaction_start",
        "compaction_end",
        "message_start",
        "message_end",
        "agent_end", // the held one
        "agent_end", // the new one, forwarded after the flush
      ]);
    });

    it("should treat a completed message after compaction as the continuation and drop the hold", () => {
      interceptor.process(overflowEnd());
      interceptor.process(compactionEnd());
      interceptor.process(ev("message_end", { message: { role: "assistant", content: [], stopReason: "stop" } }));
      vi.advanceTimersByTime(60_000);
      expect(types()).toEqual(["compaction_end", "message_end"]);
    });

    it("should replay when the run settles without a continuation (agent_settled)", () => {
      runRecovery();
      interceptor.process(ev("agent_settled"));
      expect(types()).toEqual([
        "turn_end",
        "compaction_start",
        "compaction_end",
        "message_start",
        "message_end",
        "agent_end",
        "agent_settled",
      ]);
    });
  });

  describe("failed recovery", () => {
    it("should replay with pi's friendlier error text when compaction_end carries one", () => {
      const friendly = "Context overflow recovery failed after one compact-and-retry attempt.";
      interceptor.process(overflowEnd());
      interceptor.process(agentEnd());
      // The one-attempt guard emits compaction_end WITHOUT a compaction_start.
      interceptor.process(compactionEnd({ willRetry: false, errorMessage: friendly }));

      expect(types()).toEqual(["compaction_end", "message_start", "message_end", "agent_end"]);
      const replayed = emitted[2] as { message?: { errorMessage?: string } };
      expect(replayed.message?.errorMessage).toBe(friendly);
    });

    it("should replay with the original provider error when compaction was aborted", () => {
      interceptor.process(overflowEnd());
      interceptor.process(agentEnd());
      interceptor.process(compactionStart());
      interceptor.process(compactionEnd({ aborted: true, willRetry: false }));

      expect(types()).toEqual(["compaction_start", "compaction_end", "message_start", "message_end", "agent_end"]);
      const replayed = emitted[3] as { message?: { errorMessage?: string } };
      expect(replayed.message?.errorMessage).toBe(OVERFLOW_TEXT);
    });

    it("should replay the synthetic message_start with the same message as the message_end", () => {
      interceptor.process(overflowEnd());
      interceptor.process(compactionEnd({ willRetry: false, errorMessage: "failed" }));
      const start = emitted[1] as { message?: unknown };
      const end = emitted[2] as { message?: unknown };
      expect(start.message).toEqual(end.message);
    });
  });

  describe("no compaction coming", () => {
    it("should replay in order after the hold timeout when nothing follows", () => {
      interceptor.process(overflowEnd());
      interceptor.process(agentEnd());
      vi.advanceTimersByTime(10_000);
      expect(types()).toEqual(["message_start", "message_end", "agent_end"]);
    });

    it("should stay silent just before the timeout and replay at it", () => {
      interceptor.process(overflowEnd());
      vi.advanceTimersByTime(9_999);
      expect(emitted).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(types()).toEqual(["message_start", "message_end"]);
    });

    it("should flush the held error before forwarding an unexpected new run", () => {
      interceptor.process(overflowEnd());
      interceptor.process(agentEnd());
      interceptor.process(ev("agent_start")); // user re-prompted; no compaction happened
      expect(types()).toEqual(["message_start", "message_end", "agent_end", "agent_start"]);
    });

    it("should flush the held error when the run settles without compaction (agent_settled)", () => {
      interceptor.process(overflowEnd());
      interceptor.process(agentEnd());
      interceptor.process(ev("agent_settled"));
      expect(types()).toEqual(["message_start", "message_end", "agent_end", "agent_settled"]);
    });

    it("should flush the held error before forwarding an unexpected completed message", () => {
      interceptor.process(overflowEnd());
      interceptor.process(ev("message_end", { message: { role: "assistant", content: [], stopReason: "stop" } }));
      expect(types()).toEqual(["message_start", "message_end", "message_end"]);
    });

    it("should flush the first overflow before holding a second one", () => {
      interceptor.process(overflowEnd());
      interceptor.process(ev("message_end", { message: { ...overflowMessage, errorMessage: OVERFLOW_TEXT } }));
      // First hold replayed; the second overflow is now held instead.
      expect(types()).toEqual(["message_start", "message_end"]);
      vi.advanceTimersByTime(10_000);
      expect(types()).toEqual(["message_start", "message_end", "message_start", "message_end"]);
    });
  });

  describe("flush()", () => {
    it("should replay held events when flushed (child crash path)", () => {
      interceptor.process(overflowEnd());
      interceptor.process(agentEnd());
      interceptor.flush(A);
      expect(types()).toEqual(["message_start", "message_end", "agent_end"]);
    });

    it("should do nothing when flushing a session with no hold", () => {
      interceptor.flush(A);
      expect(emitted).toHaveLength(0);
    });

    it("should not replay again when the timer elapses after a flush", () => {
      interceptor.process(overflowEnd());
      interceptor.flush(A);
      vi.advanceTimersByTime(60_000);
      expect(types()).toEqual(["message_start", "message_end"]);
    });
  });

  describe("per-session isolation", () => {
    it("should keep holding session A while passing session B's events through", () => {
      interceptor.process(overflowEnd(A));
      interceptor.process(ev("agent_start", {}, B));
      interceptor.process(overflowEnd(B));
      interceptor.process(compactionEnd({ willRetry: false, errorMessage: "failed" })); // session A
      // B's agent_start passed; B's overflow is held separately; A replayed.
      expect(emitted.map((e) => [e.type, e.sessionPath])).toEqual([
        ["agent_start", B],
        ["compaction_end", A],
        ["message_start", A],
        ["message_end", A],
      ]);
    });
  });

  describe("persistent compaction record (deferred marker)", () => {
    const result = { summary: "Earlier: reviewed Q1 spending.", tokensBefore: 31000 };
    const userStart = () => ev("message_start", { message: { role: "user", content: [] } });

    it("should park the marker on a successful compaction instead of injecting it", () => {
      interceptor.process(ev("compaction_start", { reason: "threshold" }));
      interceptor.process(compactionEnd({ reason: "threshold", willRetry: false, result }));
      // No transcript message yet — injecting here would break the turn anchor.
      expect(types()).toEqual(["compaction_start", "compaction_end"]);
      expect(getPendingCompactionMarkers(A)).toEqual([
        { summary: result.summary, tokensBefore: 31000, timestamp: expect.any(Number) },
      ]);
    });

    it("should inject the parked marker right before the next user prompt", () => {
      interceptor.process(ev("compaction_start", { reason: "threshold" }));
      interceptor.process(compactionEnd({ reason: "threshold", willRetry: false, result }));
      interceptor.process(userStart());
      expect(types()).toEqual(["compaction_start", "compaction_end", "message_start", "message_start"]);
      const marker = emitted[2] as { message?: { role?: string; summary?: string } };
      const user = emitted[3] as { message?: { role?: string } };
      expect(marker.message?.role).toBe("compactionSummary");
      expect(marker.message?.summary).toBe(result.summary);
      expect(user.message?.role).toBe("user");
      expect(getPendingCompactionMarkers(A)).toEqual([]);
    });

    it("should inject the marker only once", () => {
      interceptor.process(compactionEnd({ reason: "threshold", willRetry: false, result }));
      interceptor.process(userStart());
      interceptor.process(userStart());
      expect(types().filter((t) => t === "message_start")).toHaveLength(3); // marker + two user prompts
    });

    it("should park the marker for a successful overflow recovery too", () => {
      interceptor.process(overflowEnd());
      interceptor.process(agentEnd());
      interceptor.process(compactionStart());
      interceptor.process(compactionEnd({ result }));
      expect(types()).toEqual(["compaction_start", "compaction_end"]);
      expect(getPendingCompactionMarkers(A)).toHaveLength(1);
    });

    it("should park both markers when two compactions happen before the next prompt", () => {
      interceptor.process(compactionEnd({ reason: "overflow", result }));
      interceptor.process(ev("agent_start"));
      interceptor.process(compactionEnd({ reason: "threshold", willRetry: false, result: { summary: "second" } }));
      expect(getPendingCompactionMarkers(A)).toHaveLength(2);
      interceptor.process(userStart());
      const roles = emitted.map((e) => (e as { message?: { role?: string } }).message?.role).filter(Boolean);
      expect(roles).toEqual(["compactionSummary", "compactionSummary", "user"]);
    });

    it("should park nothing when the compaction failed", () => {
      interceptor.process(ev("compaction_start", { reason: "threshold" }));
      interceptor.process(
        compactionEnd({ reason: "threshold", willRetry: false, errorMessage: "Auto-compaction failed" }),
      );
      expect(getPendingCompactionMarkers(A)).toEqual([]);
    });

    it("should park nothing when compaction_end carries no result", () => {
      interceptor.process(ev("compaction_start", { reason: "manual" }));
      interceptor.process(compactionEnd({ reason: "manual", willRetry: false }));
      expect(getPendingCompactionMarkers(A)).toEqual([]);
    });

    it("should keep sessions separate", () => {
      interceptor.process(compactionEnd({ reason: "threshold", willRetry: false, result }));
      interceptor.process(ev("message_start", { message: { role: "user", content: [] } }, B));
      // B's prompt must not consume A's parked marker.
      expect(getPendingCompactionMarkers(A)).toHaveLength(1);
    });
  });

  describe("compactionState()", () => {
    it("should be undefined for a session that never compacted", () => {
      interceptor.process(ev("agent_start"));
      expect(interceptor.compactionState(A)).toBeUndefined();
    });

    it("should mirror an active compaction with its reason", () => {
      interceptor.process(ev("compaction_start", { reason: "threshold" }));
      expect(interceptor.compactionState(A)).toEqual({ active: true, reason: "threshold", everCompacted: true });
    });

    it("should mirror a finished compaction as inactive but everCompacted", () => {
      interceptor.process(ev("compaction_start", { reason: "manual" }));
      interceptor.process(ev("compaction_end", { reason: "manual", aborted: false, willRetry: false }));
      expect(interceptor.compactionState(A)).toEqual({ active: false, reason: "manual", everCompacted: true });
    });

    it("should track compaction per session", () => {
      interceptor.process(ev("compaction_start", { reason: "threshold" }, A));
      expect(interceptor.compactionState(B)).toBeUndefined();
    });
  });
});
