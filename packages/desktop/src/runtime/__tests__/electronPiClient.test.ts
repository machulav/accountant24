import type { PiSendMessageInput } from "@assistant-ui/react-pi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAttachmentRef } from "../../lib/attachmentMarker";
import { createElectronPiClient } from "../electronPiClient";

// electronPiClient bridges the pi RPC stream to the runtime and reports the
// anonymous usage events (message/tool counts + coarse props — never content).
// The agentBridge (sidecar IPC) and rpc/api (Electron IPC) are the faked I/O
// boundaries; the client's own mapping/analytics logic runs for real.

const h = vi.hoisted(() => ({
  listeners: [] as Array<(e: unknown) => void>,
  sent: [] as Record<string, unknown>[],
  /** get_messages response — per-test override for transcript contents. */
  messages: [] as unknown[],
  /** get_state response — per-test override for the model under test. */
  state: {} as Record<string, unknown>,
  /** skills_list response — feeds the skill_used native/custom lookup. */
  skills: [] as { name: string; description: string; enabled: boolean; native?: boolean }[],
  track: vi.fn(),
  trackOnce: vi.fn(),
}));

vi.mock("../agentBridge", () => ({
  agentBridge: {
    addEventListener: (fn: (e: unknown) => void) => {
      h.listeners.push(fn);
      return () => {};
    },
    addErrorListener: () => () => {},
    send: async (command: Record<string, unknown>) => {
      h.sent.push(command);
    },
    request: async (command: { type: string }) => {
      if (command.type === "get_state") return h.state;
      if (command.type === "get_messages") return { messages: h.messages };
      return {};
    },
  },
}));
vi.mock("../../rpc/api", () => ({
  analyticsApi: { track: h.track, trackOnce: h.trackOnce },
  sessionsApi: { list: async () => ({ type: "sessions", sessions: [] }), delete: async () => ({}) },
  settingsApi: { get: async () => ({}) },
  skillsApi: { list: async () => ({ skills: h.skills }) },
  agentApi: { onModelsChanged: () => () => {} },
}));

/** Deliver a sidecar event to every persistent listener the client registered. */
const emit = (event: Record<string, unknown>) => {
  for (const fn of h.listeners) fn(event);
};

const toolEnd = (toolName: string, isError = false) => ({
  type: "tool_execution_end",
  toolCallId: "t1",
  toolName,
  isError,
});

const message = (text: string, attachments?: string[]) =>
  ({ content: text, ...(attachments ? { attachments } : {}) }) as unknown as PiSendMessageInput;

beforeEach(() => {
  h.listeners.length = 0;
  h.sent.length = 0;
  h.messages = [];
  h.state = { model: { provider: "anthropic", id: "claude-x" }, sessionFile: "/ws/sessions/s1.jsonl" };
  h.skills = [{ name: "subscription-audit", description: "Audit.", enabled: true, native: true }];
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
      client.subscribe("pending-1", () => {}, { includeSnapshot: false });
      client.subscribe("pending-2", () => {}, { includeSnapshot: false });
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
      emit({
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
      emit({
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
      emit({ type: "tool_execution_start", toolCallId: "t4", toolName: "read", args: { path: "/ws/memory.md" } });
      emit({ type: "tool_execution_start", toolCallId: "t5", toolName: "bash", args: { command: "ls" } });
      expect(skillUsedCalls()).toHaveLength(0);
    });
  });

  describe("agent replies", () => {
    it("should track agent_message_sent when an agent turn ends", () => {
      const client = createElectronPiClient();
      client.subscribe("pending-1", () => {}, { includeSnapshot: false });
      emit({ type: "agent_end" });
      expect(h.track).toHaveBeenCalledWith("agent_message_sent");
    });

    it("should count an agent reply exactly once even with multiple thread subscriptions", () => {
      const client = createElectronPiClient();
      client.subscribe("pending-1", () => {}, { includeSnapshot: false });
      client.subscribe("pending-2", () => {}, { includeSnapshot: false });
      emit({ type: "agent_end" });
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
      expect(h.sent.at(-1)).toMatchObject({ type: "prompt", message: "add 12 EUR for coffee" });
    });

    it("should hoist a skill chip into pi's leading /skill: token on send", async () => {
      const client = createElectronPiClient();
      const snapshot = await client.createThread({});
      await client.sendMessage(snapshot.metadata.id, message(":skill[pdf] summarize this receipt"));
      expect(h.sent.at(-1)).toMatchObject({ type: "prompt", message: "/skill:pdf summarize this receipt" });
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

    it("should report the new chat's model for its initial message, not the previous session's", async () => {
      const client = createElectronPiClient();
      await client.getThread("/ws/sessions/old.jsonl"); // caches the previous session's model
      h.state = { model: { provider: "openai-codex", id: "gpt-x" }, sessionFile: "/ws/sessions/s2.jsonl" };
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

    it("should track chat_created when a new thread is created", async () => {
      const client = createElectronPiClient();
      await client.createThread({});
      expect(h.track).toHaveBeenCalledWith("chat_created");
    });
  });
});
