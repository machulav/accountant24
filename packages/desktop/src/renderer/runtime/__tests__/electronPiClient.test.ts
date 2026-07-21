import type { PiClientEvent, PiSendMessageInput } from "@assistant-ui/react-pi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAttachmentRef } from "../../lib/attachmentMarker";
import { createElectronPiClient } from "../electronPiClient";
import { newChatModel } from "../newChatModel";

// electronPiClient bridges the per-session pi RPC streams to the runtime
// (routing every command and event by threadId = sessionPath) and reports the
// anonymous usage events (message/tool counts + coarse props — never content).
// The agentBridge (sidecar IPC) and rpc/api (Electron IPC) are the faked I/O
// boundaries; the client's own routing/mapping/analytics logic runs for real.

const h = vi.hoisted(() => ({
  listeners: [] as Array<(e: unknown) => void>,
  errorListeners: [] as Array<(sessionPath: string, msg: string) => void>,
  /** Every command routed through agentBridge.send, with its target session. */
  sent: [] as { sessionPath: string; command: Record<string, unknown> }[],
  /** Every command routed through agentBridge.request, with its target session. */
  requests: [] as { sessionPath: string; command: Record<string, unknown> }[],
  /** The path agent_create_session mints for the next new chat. */
  newSessionPath: "/ws/sessions/new.jsonl",
  /** get_messages response — per-test override for transcript contents. */
  messages: [] as unknown[],
  /** get_state response — per-test override for the model under test. */
  state: {} as Record<string, unknown>,
  /** auth_models response — per-test override for the model catalog. */
  availableModels: [] as unknown[],
  /** sessions_list response — per-test override for the thread list. */
  sessions: [] as unknown[],
  /** app settings — per-test override for defaultModel etc. */
  settings: {} as Record<string, unknown>,
  /** when true, settingsApi.get rejects (settings unreadable). */
  settingsThrows: false,
  /** session paths passed to sessionsApi.delete. */
  deleted: [] as string[],
  /** request types that should reject, to exercise error/edge paths. */
  errorTypes: new Set<string>(),
  /** skills_list response — feeds the skill_used native/custom lookup. */
  skills: [] as { name: string; description: string; enabled: boolean; native?: boolean }[],
  track: vi.fn(),
  trackOnce: vi.fn(),
}));

vi.mock("../agentBridge", () => ({
  agentBridge: {
    addEventListener: (fn: (e: unknown) => void) => {
      h.listeners.push(fn);
      return () => {
        const i = h.listeners.indexOf(fn);
        if (i >= 0) h.listeners.splice(i, 1);
      };
    },
    addErrorListener: (fn: (sessionPath: string, msg: string) => void) => {
      h.errorListeners.push(fn);
      return () => {
        const i = h.errorListeners.indexOf(fn);
        if (i >= 0) h.errorListeners.splice(i, 1);
      };
    },
    send: async (sessionPath: string, command: Record<string, unknown>) => {
      h.sent.push({ sessionPath, command });
    },
    request: async (sessionPath: string, command: { type: string }) => {
      h.requests.push({ sessionPath, command: command as Record<string, unknown> });
      if (h.errorTypes.has(command.type)) throw new Error(`fail:${command.type}`);
      if (command.type === "get_state") return h.state;
      if (command.type === "get_messages") return { messages: h.messages };
      return {};
    },
  },
}));
vi.mock("../../rpc/api", () => ({
  analyticsApi: { track: h.track, trackOnce: h.trackOnce },
  sessionsApi: {
    list: async () => ({ type: "sessions", sessions: h.sessions }),
    delete: async (path: string) => {
      h.deleted.push(path);
      return {};
    },
  },
  settingsApi: {
    get: async () => {
      if (h.settingsThrows) throw new Error("settings unreadable");
      return h.settings;
    },
  },
  skillsApi: { list: async () => ({ skills: h.skills }) },
  authApi: { models: async () => ({ type: "models", models: h.availableModels }) },
  agentApi: {
    onModelsChanged: () => () => {},
    createSession: async () => h.newSessionPath,
  },
}));

/** Deliver a sidecar event to every persistent listener the client registered. */
const emit = (event: Record<string, unknown>) => {
  for (const fn of h.listeners) fn(event);
};

/** Deliver a sidecar error for one session to every error listener. */
const emitError = (sessionPath: string, msg: string) => {
  for (const fn of [...h.errorListeners]) fn(sessionPath, msg);
};

/** The live-only subscription target for event-mapping tests. */
const LIVE = "/ws/sessions/live.jsonl";
/** Emit an event tagged as coming from LIVE's child. */
const emitL = (event: Record<string, unknown>) => emit({ ...event, sessionPath: LIVE });

const toolEnd = (toolName: string, isError = false) => ({
  type: "tool_execution_end",
  toolCallId: "t1",
  toolName,
  isError,
  sessionPath: LIVE,
});

const message = (text: string, attachments?: string[]) =>
  ({ content: text, ...(attachments ? { attachments } : {}) }) as unknown as PiSendMessageInput;

/** All commands routed through agentBridge.send, regardless of session. */
const sentCmds = () => h.sent.map((s) => s.command);
/** All commands routed through agentBridge.request, regardless of session. */
const requestCmds = () => h.requests.map((r) => r.command);

beforeEach(() => {
  h.listeners.length = 0;
  h.errorListeners.length = 0;
  h.sent.length = 0;
  h.requests.length = 0;
  h.newSessionPath = "/ws/sessions/new.jsonl";
  h.messages = [];
  h.availableModels = [];
  h.sessions = [];
  h.settings = {};
  h.settingsThrows = false;
  h.deleted.length = 0;
  h.errorTypes = new Set();
  h.state = { model: { provider: "anthropic", id: "claude-x" }, sessionFile: "/ws/sessions/s1.jsonl" };
  h.skills = [{ name: "subscription-audit", description: "Audit.", enabled: true, native: true }];
  newChatModel.set(undefined);
});

/** Let the client's async skills-lookup fetch settle. */
const flushLookup = () => new Promise((resolve) => setTimeout(resolve, 0));

const skillUsedCalls = () => h.track.mock.calls.filter(([event]) => event === "skill_used");

describe("createElectronPiClient() analytics", () => {
  describe("tool usage", () => {
    it("should track agent_tool_used with status ok when a tool run completes", () => {
      createElectronPiClient();
      emit(toolEnd("query"));
      expect(h.track).toHaveBeenCalledWith("agent_tool_used", { tool: "query", status: "ok" });
    });

    it("should track agent_tool_used with status error when a tool run fails", () => {
      createElectronPiClient();
      emit(toolEnd("validate", true));
      expect(h.track).toHaveBeenCalledWith("agent_tool_used", { tool: "validate", status: "error" });
    });

    it("should track the one-time transaction_first_added when add_transactions succeeds", () => {
      createElectronPiClient();
      emit(toolEnd("add_transactions"));
      expect(h.trackOnce).toHaveBeenCalledWith("transaction_first_added");
    });

    it("should not track transaction_first_added when add_transactions fails", () => {
      createElectronPiClient();
      emit(toolEnd("add_transactions", true));
      expect(h.trackOnce).not.toHaveBeenCalled();
    });

    it("should not track transaction_first_added for other tools", () => {
      createElectronPiClient();
      emit(toolEnd("query"));
      emit(toolEnd("commit_and_push"));
      expect(h.trackOnce).not.toHaveBeenCalled();
    });

    it("should count a tool run exactly once even with multiple thread subscriptions", () => {
      const client = createElectronPiClient();
      client.subscribe(LIVE, () => {}, { includeSnapshot: false });
      client.subscribe("/ws/sessions/other.jsonl", () => {}, { includeSnapshot: false });
      emit(toolEnd("query"));
      expect(h.track.mock.calls.filter(([event]) => event === "agent_tool_used")).toHaveLength(1);
    });
  });

  describe("skill usage", () => {
    it("should track a manual native invocation by name", async () => {
      const client = createElectronPiClient();
      await flushLookup();
      const snapshot = await client.createThread({});
      await client.sendMessage(snapshot.metadata.id, message(":skill[subscription-audit] check my subs"));
      expect(h.track).toHaveBeenCalledWith("skill_used", {
        skill: "subscription-audit",
        kind: "native",
        method: "manual",
      });
    });

    it("should track a manual custom invocation anonymously", async () => {
      const client = createElectronPiClient();
      await flushLookup();
      const snapshot = await client.createThread({});
      await client.sendMessage(snapshot.metadata.id, message(":skill[nutrition-coach] log lunch"));
      expect(h.track).toHaveBeenCalledWith("skill_used", { skill: "custom", kind: "custom", method: "manual" });
    });

    it("should not track skill_used for a plain message", async () => {
      const client = createElectronPiClient();
      await flushLookup();
      const snapshot = await client.createThread({});
      await client.sendMessage(snapshot.metadata.id, message("what is my net worth?"));
      expect(skillUsedCalls()).toHaveLength(0);
    });

    it("should track the model reading a native SKILL.md as auto usage by name", async () => {
      createElectronPiClient();
      await flushLookup();
      emitL({
        type: "tool_execution_start",
        toolCallId: "t2",
        toolName: "read",
        args: { path: "/app/resources/skills/subscription-audit/SKILL.md" },
      });
      expect(h.track).toHaveBeenCalledWith("skill_used", {
        skill: "subscription-audit",
        kind: "native",
        method: "auto",
      });
    });

    it("should track the model reading a custom SKILL.md anonymously (file_path arg variant)", async () => {
      createElectronPiClient();
      await flushLookup();
      emitL({
        type: "tool_execution_start",
        toolCallId: "t3",
        toolName: "read",
        args: { file_path: "/ws/skills/nutrition-coach/SKILL.md" },
      });
      expect(h.track).toHaveBeenCalledWith("skill_used", { skill: "custom", kind: "custom", method: "auto" });
    });

    it("should not track reads of ordinary files", async () => {
      createElectronPiClient();
      await flushLookup();
      emitL({ type: "tool_execution_start", toolCallId: "t4", toolName: "read", args: { path: "/ws/memory.md" } });
      emitL({ type: "tool_execution_start", toolCallId: "t5", toolName: "bash", args: { command: "ls" } });
      expect(skillUsedCalls()).toHaveLength(0);
    });
  });

  describe("agent replies", () => {
    it("should track agent_message_sent when an agent turn ends", () => {
      const client = createElectronPiClient();
      client.subscribe(LIVE, () => {}, { includeSnapshot: false });
      emitL({ type: "agent_end" });
      expect(h.track).toHaveBeenCalledWith("agent_message_sent");
    });

    it("should count an agent reply exactly once even with multiple thread subscriptions", () => {
      const client = createElectronPiClient();
      client.subscribe(LIVE, () => {}, { includeSnapshot: false });
      client.subscribe("/ws/sessions/other.jsonl", () => {}, { includeSnapshot: false });
      emitL({ type: "agent_end" });
      expect(h.track.mock.calls.filter(([event]) => event === "agent_message_sent")).toHaveLength(1);
    });
  });

  describe("user messages", () => {
    it("should track user_message_sent with has_attachment false and the session's model", async () => {
      const client = createElectronPiClient();
      const snapshot = await client.createThread({});
      await client.sendMessage(snapshot.metadata.id, message("hi"));
      expect(h.track).toHaveBeenCalledWith("user_message_sent", {
        has_attachment: "false",
        model: "anthropic/claude-x",
      });
    });

    it("should track has_attachment true when the message carries attachments", async () => {
      const client = createElectronPiClient();
      const snapshot = await client.createThread({});
      await client.sendMessage(snapshot.metadata.id, message("receipt", ["data:image/png;base64,x"]));
      expect(h.track).toHaveBeenCalledWith("user_message_sent", {
        has_attachment: "true",
        model: "anthropic/claude-x",
      });
    });

    it("should track has_attachment true when the message carries a document marker in its content", async () => {
      const client = createElectronPiClient();
      const snapshot = await client.createThread({});
      const marker = encodeAttachmentRef({ name: "statement.pdf", path: "/ws/files/statement.pdf" });
      await client.sendMessage(snapshot.metadata.id, message(`process this\n${marker}`));
      expect(h.track).toHaveBeenCalledWith("user_message_sent", {
        has_attachment: "true",
        model: "anthropic/claude-x",
      });
    });

    it("should track has_attachment false when the content contains a malformed marker only", async () => {
      const client = createElectronPiClient();
      const snapshot = await client.createThread({});
      await client.sendMessage(snapshot.metadata.id, message("[[attachment]]not-json"));
      expect(h.track).toHaveBeenCalledWith("user_message_sent", {
        has_attachment: "false",
        model: "anthropic/claude-x",
      });
    });

    it("should track the one-time user_first_message_sent on send", async () => {
      const client = createElectronPiClient();
      const snapshot = await client.createThread({});
      await client.sendMessage(snapshot.metadata.id, message("hi"));
      expect(h.trackOnce).toHaveBeenCalledWith("user_first_message_sent");
    });

    it("should send plain text verbatim as the prompt message", async () => {
      const client = createElectronPiClient();
      const snapshot = await client.createThread({});
      await client.sendMessage(snapshot.metadata.id, message("add 12 EUR for coffee"));
      expect(sentCmds().at(-1)).toMatchObject({ type: "prompt", message: "add 12 EUR for coffee" });
    });

    it("should hoist a skill chip into pi's leading /skill: token on send", async () => {
      const client = createElectronPiClient();
      const snapshot = await client.createThread({});
      await client.sendMessage(snapshot.metadata.id, message(":skill[pdf] summarize this receipt"));
      expect(sentCmds().at(-1)).toMatchObject({ type: "prompt", message: "/skill:pdf summarize this receipt" });
    });

    it("should collapse pi's expanded skill block back to the directive in transcript snapshots", async () => {
      const client = createElectronPiClient();
      const snapshot = await client.createThread({});
      h.messages = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: '<skill name="pdf" location="/ws/skills/pdf/SKILL.md">\ninjected instructions\n</skill>\n\nsummarize this receipt',
            },
          ],
          timestamp: 1,
        },
        { role: "assistant", content: [{ type: "text", text: "Done." }], timestamp: 2 },
      ];
      const thread = await client.getThread(snapshot.metadata.id);
      const user = thread.messages[0] as { content: Array<{ text: string }> };
      // Must equal the composer's original text exactly — the runtime dedupes
      // its optimistic message copy against the transcript by text equality.
      expect(user.content[0].text).toBe(":skill[pdf] summarize this receipt");
      const assistant = thread.messages[1] as { content: Array<{ text: string }> };
      expect(assistant.content[0].text).toBe("Done.");
    });

    it("should omit the model prop when no model is known yet", async () => {
      h.state = {};
      const client = createElectronPiClient();
      const snapshot = await client.createThread({});
      await client.sendMessage(snapshot.metadata.id, message("hi"));
      expect(h.track).toHaveBeenCalledWith("user_message_sent", { has_attachment: "false" });
    });

    it("should report the new chat's model for its initial message, not another thread's", async () => {
      const client = createElectronPiClient();
      await client.getThread("/ws/sessions/old.jsonl"); // caches the old thread's model
      h.state = { model: { provider: "openai-codex", id: "gpt-x" }, sessionFile: "/ws/sessions/new.jsonl" };
      await client.createThread({ initialMessage: message("hi") });
      expect(h.track).toHaveBeenCalledWith("user_message_sent", {
        has_attachment: "false",
        model: "openai-codex/gpt-x",
      });
    });

    it("should report the new model after setModel", async () => {
      const client = createElectronPiClient();
      const snapshot = await client.createThread({});
      await client.setModel(snapshot.metadata.id, { provider: "openai", modelId: "gpt-x" });
      await client.sendMessage(snapshot.metadata.id, message("hi"));
      expect(h.track).toHaveBeenCalledWith("user_message_sent", {
        has_attachment: "false",
        model: "openai/gpt-x",
      });
    });

    it("should keep each thread's model separate for analytics", async () => {
      const client = createElectronPiClient();
      const snapshot = await client.createThread({});
      await client.setModel("/ws/sessions/other.jsonl", { provider: "openai", modelId: "gpt-x" });
      await client.sendMessage(snapshot.metadata.id, message("hi"));
      // The other thread's setModel must not bleed into this thread's prop.
      expect(h.track).toHaveBeenCalledWith("user_message_sent", {
        has_attachment: "false",
        model: "anthropic/claude-x",
      });
    });

    it("should track chat_created when a new thread is created", async () => {
      const client = createElectronPiClient();
      await client.createThread({});
      expect(h.track).toHaveBeenCalledWith("chat_created");
    });
  });
});

// ---------------------------------------------------------------------------
// Event mapping, thread bridging, snapshots and mutations — the transport
// surface the runtime drives. The agentBridge/rpc I/O boundaries stay faked;
// the client's own mapping/serialization runs for real.
// ---------------------------------------------------------------------------

const A_MODEL = { provider: "anthropic", id: "claude-x" };
const skillBlockUser = {
  role: "user",
  content: [
    {
      type: "text",
      text: '<skill name="pdf" location="/ws/skills/pdf/SKILL.md">\ninjected\n</skill>\n\nsummarize this receipt',
    },
  ],
};

/** Subscribe live-only (no snapshot), collecting the mapped client events. */
const captureLive = (client: ReturnType<typeof createElectronPiClient>, threadId = LIVE) => {
  const events: PiClientEvent[] = [];
  const unsub = client.subscribe(threadId, (e) => events.push(e), { includeSnapshot: false });
  return { events, unsub };
};

/** Read the mutable body fields of a captured event without fighting the union. */
const body = (e: PiClientEvent) => e as unknown as Record<string, unknown>;

describe("createElectronPiClient() event mapping", () => {
  it("should map agent_start to an agent_start body stamped with thread + seq", () => {
    const { events } = captureLive(createElectronPiClient());
    emitL({ type: "agent_start" });
    expect(events[0]).toMatchObject({ type: "agent_start", threadId: LIVE, seq: 1 });
  });

  it("should map agent_end to an agent_end body", () => {
    const { events } = captureLive(createElectronPiClient());
    emitL({ type: "agent_end" });
    expect(events[0]).toMatchObject({ type: "agent_end" });
  });

  it("should number turns from zero, incrementing on each turn_start", () => {
    const { events } = captureLive(createElectronPiClient());
    emitL({ type: "turn_start" });
    emitL({ type: "turn_start" });
    expect(events.map((e) => body(e).turnIndex)).toEqual([0, 1]);
  });

  it("should stamp turn_end with the current turn index", () => {
    const { events } = captureLive(createElectronPiClient());
    emitL({ type: "turn_start" });
    emitL({ type: "turn_end" });
    expect(events[1]).toMatchObject({ type: "turn_end", turnIndex: 0 });
  });

  it("should default turn_end to turn zero when no turn has started", () => {
    const { events } = captureLive(createElectronPiClient());
    emitL({ type: "turn_end" });
    expect(events[0]).toMatchObject({ type: "turn_end", turnIndex: 0 });
  });

  it("should pass an assistant message through message_start unchanged", () => {
    const { events } = captureLive(createElectronPiClient());
    const msg = { role: "assistant", content: [{ type: "text", text: "hi" }] };
    emitL({ type: "message_start", message: msg });
    expect(body(events[0]).message).toEqual(msg);
  });

  it("should collapse a skill block in a message_start user message back to the directive", () => {
    const { events } = captureLive(createElectronPiClient());
    emitL({ type: "message_start", message: skillBlockUser });
    const message = body(events[0]).message as { content: Array<{ text: string }> };
    expect(message.content[0].text).toBe(":skill[pdf] summarize this receipt");
  });

  it("should carry a text_delta through message_update as its assistantMessageEvent", () => {
    const { events } = captureLive(createElectronPiClient());
    const delta = { type: "text_delta", text: "hel" };
    emitL({ type: "message_update", message: { role: "assistant", content: [] }, assistantMessageEvent: delta });
    expect(events[0]).toMatchObject({ type: "message_update", assistantMessageEvent: delta });
  });

  it("should carry a thinking_delta through message_update as its assistantMessageEvent", () => {
    const { events } = captureLive(createElectronPiClient());
    const delta = { type: "thinking_delta", thinking: "hmm" };
    emitL({ type: "message_update", message: { role: "assistant", content: [] }, assistantMessageEvent: delta });
    expect(events[0]).toMatchObject({ type: "message_update", assistantMessageEvent: delta });
  });

  it("should pass the final message through message_end", () => {
    const { events } = captureLive(createElectronPiClient());
    const msg = { role: "assistant", content: [{ type: "text", text: "done" }] };
    emitL({ type: "message_end", message: msg });
    expect(body(events[0])).toMatchObject({ type: "message_end", message: msg });
  });

  it("should map tool_execution_start with its id, name and args", () => {
    const { events } = captureLive(createElectronPiClient());
    emitL({ type: "tool_execution_start", toolCallId: "t1", toolName: "query", args: { sql: "x" } });
    expect(events[0]).toMatchObject({
      type: "tool_execution_start",
      toolCallId: "t1",
      toolName: "query",
      args: { sql: "x" },
    });
  });

  it("should map tool_execution_update with an undefined partial result", () => {
    const { events } = captureLive(createElectronPiClient());
    emitL({ type: "tool_execution_update", toolCallId: "t1", toolName: "query" });
    expect(events[0]).toMatchObject({ type: "tool_execution_update", toolCallId: "t1", toolName: "query" });
    expect(body(events[0]).partialResult).toBeUndefined();
  });

  it("should map tool_execution_end carrying the result and a false error flag by default", () => {
    const { events } = captureLive(createElectronPiClient());
    emitL({ type: "tool_execution_end", toolCallId: "t1", toolName: "query", result: { rows: 3 } });
    expect(events[0]).toMatchObject({
      type: "tool_execution_end",
      toolCallId: "t1",
      result: { rows: 3 },
      isError: false,
    });
  });

  it("should coerce a truthy error into isError true on tool_execution_end", () => {
    const { events } = captureLive(createElectronPiClient());
    emitL({ type: "tool_execution_end", toolCallId: "t1", toolName: "query", isError: true });
    expect(events[0]).toMatchObject({ type: "tool_execution_end", isError: true });
  });

  it("should pass an unrecognized event type through as a bare typed body", () => {
    const { events } = captureLive(createElectronPiClient());
    emitL({ type: "queue_update", queue: [] });
    expect(events[0]).toMatchObject({ type: "queue_update", threadId: LIVE, seq: 1 });
  });

  it("should stamp a strictly increasing seq per emitted event", () => {
    const { events } = captureLive(createElectronPiClient());
    emitL({ type: "agent_start" });
    emitL({ type: "agent_end" });
    emitL({ type: "turn_start" });
    expect(events.map((e) => body(e).seq)).toEqual([1, 2, 3]);
  });

  it("should forward the session's sidecar error to the subscriber as an error event", () => {
    const { events } = captureLive(createElectronPiClient());
    emitError(LIVE, "boom");
    expect(events[0]).toMatchObject({ type: "error", error: "boom", threadId: LIVE });
  });

  it("should stop delivering events after the subscription is torn down", () => {
    const { events, unsub } = captureLive(createElectronPiClient());
    unsub();
    emitL({ type: "agent_start" });
    emitError(LIVE, "boom");
    expect(events).toHaveLength(0);
  });
});

describe("createElectronPiClient() per-session routing", () => {
  const A = "/ws/sessions/a.jsonl";
  const B = "/ws/sessions/b.jsonl";

  it("should keep session A running and streaming its events while B is viewed", async () => {
    // The A-33 regression: a run in chat A used to be aborted (switch_session)
    // and its events mis-routed to whichever thread was active. Now events
    // route by their sessionPath tag, and no session switching exists at all.
    const client = createElectronPiClient();
    const a = captureLive(client, A);
    const b = captureLive(client, B);

    emit({ type: "agent_start", sessionPath: A });
    emit({
      type: "message_update",
      message: { role: "assistant", content: [] },
      assistantMessageEvent: { type: "text_delta", text: "still going" },
      sessionPath: A,
    });

    // Viewing B (snapshot fetch) must not issue any switch command.
    await client.getThread(B);
    expect(requestCmds().some((r) => r.type === "switch_session")).toBe(false);

    // A's stream reached only A's subscriber.
    expect(a.events.map((e) => e.type)).toEqual(["agent_start", "message_update"]);
    expect(b.events).toHaveLength(0);

    // Returning to A reports it running (the run never stopped).
    const snap = await client.getThread(A);
    expect(snap.metadata.status).toBe("running");
  });

  it("should route every thread operation to its own session", async () => {
    const client = createElectronPiClient();
    await client.getThread(A);
    await client.sendMessage(B, message("hi"));
    await client.setModel(A, { provider: "openai", modelId: "gpt-x" });
    await client.setThinkingLevel(B, "high");
    await client.renameThread(A, "Budget");
    await client.cancelRun(B);

    expect(h.requests.every((r) => r.sessionPath === A)).toBe(true);
    expect(h.sent).toContainEqual({ sessionPath: B, command: expect.objectContaining({ type: "prompt" }) });
    expect(h.sent).toContainEqual({
      sessionPath: A,
      command: { type: "set_model", provider: "openai", modelId: "gpt-x" },
    });
    expect(h.sent).toContainEqual({ sessionPath: B, command: { type: "set_thinking_level", level: "high" } });
    expect(h.sent).toContainEqual({ sessionPath: A, command: { type: "set_session_name", name: "Budget" } });
    expect(h.sent).toContainEqual({ sessionPath: B, command: { type: "abort" } });
  });

  it("should mark only the crashed session as stopped, leaving the other running", async () => {
    const client = createElectronPiClient();
    emit({ type: "agent_start", sessionPath: A });
    emit({ type: "agent_start", sessionPath: B });

    emitError(A, "crash");

    const snapA = await client.getThread(A);
    const snapB = await client.getThread(B);
    expect(snapA.metadata.status).toBe("idle");
    expect(snapB.metadata.status).toBe("running");
  });

  it("should deliver a crash error only to the crashed session's subscribers", () => {
    const client = createElectronPiClient();
    const a = captureLive(client, A);
    const b = captureLive(client, B);

    emitError(A, "crash");
    expect(a.events).toEqual([expect.objectContaining({ type: "error", error: "crash", threadId: A })]);
    expect(b.events).toHaveLength(0);
  });

  it("should clear the running flag when the session's run ends", async () => {
    const client = createElectronPiClient();
    emit({ type: "agent_start", sessionPath: A });
    emit({ type: "agent_end", sessionPath: A });
    const snap = await client.getThread(A);
    expect(snap.metadata.status).toBe("idle");
  });
});

describe("createElectronPiClient() subscribe() snapshot", () => {
  it("should emit the snapshot first (seq 1) then live events (seq 2+)", async () => {
    const client = createElectronPiClient();
    const events: PiClientEvent[] = [];
    client.subscribe("/ws/sessions/s1.jsonl", (e) => events.push(e));
    await flushLookup();
    expect(events[0]).toMatchObject({ type: "snapshot", seq: 1 });
    emit({ type: "agent_end", sessionPath: "/ws/sessions/s1.jsonl" });
    expect(events[1]).toMatchObject({ type: "agent_end", seq: 2 });
  });

  it("should emit an error then still attach live events when the snapshot fetch fails", async () => {
    h.errorTypes = new Set(["get_state"]);
    const client = createElectronPiClient();
    const events: PiClientEvent[] = [];
    client.subscribe("/ws/sessions/err.jsonl", (e) => events.push(e));
    await flushLookup();
    expect(events[0]).toMatchObject({ type: "error", error: "fail:get_state", seq: 1 });
    emit({ type: "agent_start", sessionPath: "/ws/sessions/err.jsonl" });
    expect(events[1]).toMatchObject({ type: "agent_start", seq: 2 });
  });
});

describe("createElectronPiClient() createThread()", () => {
  it("should mint the thread id via agent_create_session and fetch its state", async () => {
    const client = createElectronPiClient();
    const snap = await client.createThread({});
    expect(snap.metadata.id).toBe("/ws/sessions/new.jsonl");
    expect(h.requests).toContainEqual({ sessionPath: "/ws/sessions/new.jsonl", command: { type: "get_state" } });
  });

  it("should send the initial message to the freshly minted session", async () => {
    const client = createElectronPiClient();
    await client.createThread({ initialMessage: message("hi") });
    expect(h.sent).toContainEqual({
      sessionPath: "/ws/sessions/new.jsonl",
      command: expect.objectContaining({ type: "prompt", message: "hi" }),
    });
  });

  describe("model selection", () => {
    it("should apply the pending new-chat model to the fresh session", async () => {
      newChatModel.set({ provider: "openai", modelId: "gpt-x" });
      const client = createElectronPiClient();
      await client.createThread({});
      expect(h.sent).toContainEqual({
        sessionPath: "/ws/sessions/new.jsonl",
        command: { type: "set_model", provider: "openai", modelId: "gpt-x" },
      });
    });

    it("should clear the pending model after the thread is created", async () => {
      newChatModel.set({ provider: "openai", modelId: "gpt-x" });
      const client = createElectronPiClient();
      await client.createThread({});
      expect(newChatModel.get()).toBeUndefined();
    });

    it("should fall back to the configured default model when there is no pending pick", async () => {
      h.settings = { defaultModel: "anthropic/claude-y" };
      const client = createElectronPiClient();
      await client.createThread({});
      expect(sentCmds()).toContainEqual({ type: "set_model", provider: "anthropic", modelId: "claude-y" });
    });

    it("should prefer the pending pick over the configured default", async () => {
      h.settings = { defaultModel: "anthropic/claude-y" };
      newChatModel.set({ provider: "openai", modelId: "gpt-x" });
      const client = createElectronPiClient();
      await client.createThread({});
      expect(sentCmds()).toContainEqual({ type: "set_model", provider: "openai", modelId: "gpt-x" });
      expect(sentCmds().some((c) => c.provider === "anthropic")).toBe(false);
    });

    it("should not set any model when neither a pending pick nor a default exists", async () => {
      const client = createElectronPiClient();
      await client.createThread({});
      expect(sentCmds().some((c) => c.type === "set_model")).toBe(false);
    });

    it("should not set a model for a malformed default id", async () => {
      h.settings = { defaultModel: "no-slash" };
      const client = createElectronPiClient();
      await client.createThread({});
      expect(sentCmds().some((c) => c.type === "set_model")).toBe(false);
    });

    it("should keep pi's default and still clear the pending model when settings are unreadable", async () => {
      h.settingsThrows = true;
      const client = createElectronPiClient();
      await expect(client.createThread({})).resolves.toBeDefined();
      expect(sentCmds().some((c) => c.type === "set_model")).toBe(false);
      expect(newChatModel.get()).toBeUndefined();
    });
  });
});

describe("createElectronPiClient() getThread() snapshot", () => {
  it("should report ready readiness with the session's model selection", async () => {
    const client = createElectronPiClient();
    const snap = await client.getThread("/ws/sessions/s1.jsonl");
    expect(snap.readiness).toEqual({
      state: "ready",
      selection: { provider: "anthropic", modelId: "claude-x" },
      source: "session",
    });
  });

  it("should restore a reopened thread's transcript without any prior createThread (cold start)", async () => {
    // App relaunch: the thread exists only as a session file on disk. The
    // first getThread must return its persisted history, and a follow-up
    // message must go to that same session.
    h.messages = [
      { role: "user", content: [{ type: "text", text: "hello from yesterday" }] },
      { role: "assistant", content: [{ type: "text", text: "welcome back" }] },
    ];
    h.state = { model: A_MODEL, sessionFile: "/ws/sessions/old.jsonl", sessionName: "Yesterday" };
    const client = createElectronPiClient();

    const snap = await client.getThread("/ws/sessions/old.jsonl");
    expect(snap.messages).toHaveLength(2);
    expect(snap.metadata.title).toBe("Yesterday");
    expect(snap.metadata.status).toBe("idle");

    await client.sendMessage("/ws/sessions/old.jsonl", message("continuing"));
    expect(h.sent).toContainEqual({
      sessionPath: "/ws/sessions/old.jsonl",
      command: expect.objectContaining({ type: "prompt", message: "continuing" }),
    });
  });

  it("should report missing-model readiness and a model-less config when no model is selected", async () => {
    h.state = { sessionFile: "/ws/sessions/s1.jsonl", thinkingLevel: "low" };
    const client = createElectronPiClient();
    const snap = await client.getThread("/ws/sessions/s1.jsonl");
    expect(snap.readiness).toMatchObject({ state: "missing-model" });
    expect(snap.metadata.config).toEqual({ thinkingLevel: "low" });
  });

  it("should mark the thread running when pi reports it streaming", async () => {
    h.state = { model: A_MODEL, sessionFile: "/ws/sessions/s1.jsonl", isStreaming: true };
    const client = createElectronPiClient();
    const snap = await client.getThread("/ws/sessions/s1.jsonl");
    expect(snap.metadata.status).toBe("running");
  });

  it("should mark the thread idle when it is neither streaming nor mid-run", async () => {
    const client = createElectronPiClient();
    const snap = await client.getThread("/ws/sessions/s1.jsonl");
    expect(snap.metadata.status).toBe("idle");
  });

  it("should title the thread from the session name", async () => {
    h.state = { model: A_MODEL, sessionFile: "/ws/sessions/s1.jsonl", sessionName: "Monthly budget" };
    const client = createElectronPiClient();
    const snap = await client.getThread("/ws/sessions/s1.jsonl");
    expect(snap.metadata.title).toBe("Monthly budget");
  });

  it("should fall back messageCount to the transcript length when pi omits it", async () => {
    h.messages = [
      { role: "user", content: [{ type: "text", text: "a" }] },
      { role: "assistant", content: [{ type: "text", text: "b" }] },
    ];
    const client = createElectronPiClient();
    const snap = await client.getThread("/ws/sessions/s1.jsonl");
    expect(snap.metadata.messageCount).toBe(2);
  });

  it("should use pi's reported messageCount over the transcript length", async () => {
    h.state = { model: A_MODEL, sessionFile: "/ws/sessions/s1.jsonl", messageCount: 7 };
    h.messages = [{ role: "user", content: [{ type: "text", text: "a" }] }];
    const client = createElectronPiClient();
    const snap = await client.getThread("/ws/sessions/s1.jsonl");
    expect(snap.metadata.messageCount).toBe(7);
  });

  it("should carry the model and thinking level into metadata config", async () => {
    h.state = { model: A_MODEL, sessionFile: "/ws/sessions/s1.jsonl", thinkingLevel: "high" };
    const client = createElectronPiClient();
    const snap = await client.getThread("/ws/sessions/s1.jsonl");
    expect(snap.metadata.config).toEqual({ provider: "anthropic", modelId: "claude-x", thinkingLevel: "high" });
  });
});

describe("createElectronPiClient() getAvailableModels()", () => {
  it("should map provider/id and derive supportsThinking from the reasoning flag", async () => {
    h.availableModels = [{ provider: "anthropic", id: "claude-x", name: "Claude X", reasoning: true }];
    const client = createElectronPiClient();
    expect(await client.getAvailableModels()).toEqual([
      { provider: "anthropic", modelId: "claude-x", name: "Claude X", supportsThinking: true },
    ]);
  });

  it("should report supportsThinking false and omit name when the model lacks them", async () => {
    h.availableModels = [{ provider: "openai", id: "gpt-x" }];
    const client = createElectronPiClient();
    const models = await client.getAvailableModels();
    expect(models[0]).toEqual({ provider: "openai", modelId: "gpt-x", supportsThinking: false });
  });

  it("should return an empty list when the catalog is empty", async () => {
    const client = createElectronPiClient();
    expect(await client.getAvailableModels()).toEqual([]);
  });

  it("should return an empty list when the models field is omitted", async () => {
    (h as { availableModels: unknown }).availableModels = undefined;
    const client = createElectronPiClient();
    expect(await client.getAvailableModels()).toEqual([]);
  });

  it("should not touch any session's child for the catalog", async () => {
    const client = createElectronPiClient();
    await client.getAvailableModels();
    expect(h.requests).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });
});

describe("createElectronPiClient() listThreads()", () => {
  it("should map session summaries to idle thread metadata", async () => {
    h.sessions = [
      { path: "/ws/s1.jsonl", id: "s1", name: "Budget", firstMessage: "hi", messageCount: 3, modified: "2026-01-01" },
    ];
    const client = createElectronPiClient();
    expect(await client.listThreads()).toEqual([
      {
        id: "/ws/s1.jsonl",
        status: "idle",
        title: "Budget",
        sessionFile: "/ws/s1.jsonl",
        messageCount: 3,
        updatedAt: "2026-01-01",
      },
    ]);
  });

  it("should title an unnamed session from its first message, collapsing a skill block to plain text", async () => {
    h.sessions = [
      {
        path: "/ws/s2.jsonl",
        id: "s2",
        name: "",
        firstMessage:
          '<skill name="pdf" location="/ws/skills/pdf/SKILL.md">\ninjected\n</skill>\n\nsummarize this receipt',
        messageCount: 1,
        modified: "m",
      },
    ];
    const client = createElectronPiClient();
    const list = await client.listThreads();
    // collapseSkillText → ":skill[pdf] summarize…"; mentionsToPlainText then
    // renders the skill mention as its bare label.
    expect(list[0].title).toBe("pdf summarize this receipt");
  });

  it("should fall back to the file base name when there is neither a name nor a first message", async () => {
    h.sessions = [
      { path: "/ws/dir/session-abc.jsonl", id: "s3", name: "", firstMessage: "", messageCount: 0, modified: "m" },
    ];
    const client = createElectronPiClient();
    const list = await client.listThreads();
    expect(list[0].title).toBe("session-abc.jsonl");
  });

  it("should return an empty list when there are no sessions", async () => {
    const client = createElectronPiClient();
    expect(await client.listThreads()).toEqual([]);
  });
});

describe("createElectronPiClient() thread mutations", () => {
  it("should send abort to the thread's own session on cancelRun", async () => {
    const client = createElectronPiClient();
    await client.cancelRun("/ws/s1.jsonl");
    expect(h.sent).toEqual([{ sessionPath: "/ws/s1.jsonl", command: { type: "abort" } }]);
  });

  it("should return empty steering and follow-up queues from clearQueue", async () => {
    const client = createElectronPiClient();
    expect(await client.clearQueue("/ws/s1.jsonl")).toEqual({ steering: [], followUp: [] });
  });

  it("should send set_thinking_level to the thread's own session", async () => {
    const client = createElectronPiClient();
    await client.setThinkingLevel("/ws/t.jsonl", "high");
    expect(h.sent).toEqual([{ sessionPath: "/ws/t.jsonl", command: { type: "set_thinking_level", level: "high" } }]);
  });

  it("should send set_session_name on renameThread", async () => {
    const client = createElectronPiClient();
    await client.renameThread("/ws/r.jsonl", "New name");
    expect(h.sent).toEqual([{ sessionPath: "/ws/r.jsonl", command: { type: "set_session_name", name: "New name" } }]);
  });

  it("should delete the session file on deleteThread", async () => {
    const client = createElectronPiClient();
    await client.deleteThread("/ws/d.jsonl");
    expect(h.deleted).toContain("/ws/d.jsonl");
  });

  it("should be a no-op for archiveThread and unarchiveThread", async () => {
    const client = createElectronPiClient();
    await expect(client.archiveThread("/ws/x.jsonl")).resolves.toBeUndefined();
    await expect(client.unarchiveThread("/ws/x.jsonl")).resolves.toBeUndefined();
  });
});

describe("createElectronPiClient() respondToHostUiRequest()", () => {
  it("should forward a confirmation response to the thread's session", async () => {
    const client = createElectronPiClient();
    await client.respondToHostUiRequest("/ws/t.jsonl", { requestId: "r1", confirmed: true } as never);
    expect(h.sent).toEqual([
      { sessionPath: "/ws/t.jsonl", command: { type: "extension_ui_response", id: "r1", confirmed: true } },
    ]);
  });

  it("should forward a value response as a confirmed value", async () => {
    const client = createElectronPiClient();
    await client.respondToHostUiRequest("/ws/t.jsonl", { requestId: "r2", value: "hello" } as never);
    expect(sentCmds()).toContainEqual({ type: "extension_ui_response", id: "r2", value: "hello", confirmed: true });
  });

  it("should forward a decline when neither confirmed nor value is present", async () => {
    const client = createElectronPiClient();
    await client.respondToHostUiRequest("/ws/t.jsonl", { requestId: "r3" } as never);
    expect(sentCmds()).toContainEqual({ type: "extension_ui_response", id: "r3", confirmed: false });
  });
});
