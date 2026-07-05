import { describe, expect, it, vi } from "vitest";

// analyticsEvents is the renderer's typed event vocabulary: each function owns
// one event's name + prop shape. window.api (the preload bridge) is the faked
// I/O boundary — the real rpc/api transport runs, so the asserted payloads are
// exactly what reaches main's analytics_track handler (including the `once`
// flag that decides per-install milestone semantics).
const h = vi.hoisted(() => {
  const invoke = vi.fn(() => Promise.resolve());
  (globalThis as { window?: unknown }).window = { api: { invoke, on: vi.fn() } };
  return { invoke };
});

import {
  trackAgentMessageSent,
  trackAgentToolUsed,
  trackAttachmentAdded,
  trackChatCreated,
  trackTransactionFirstAdded,
  trackUserFirstMessageSent,
  trackUserMessageSent,
} from "../analyticsEvents";

describe("trackChatCreated()", () => {
  it("should send chat_created with no props", () => {
    trackChatCreated();
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith("analytics_track", {
      event: "chat_created",
      props: undefined,
    });
  });

  it("should swallow IPC failures (fire-and-forget)", async () => {
    h.invoke.mockRejectedValueOnce(new Error("ipc down"));
    expect(() => trackChatCreated()).not.toThrow();
    await Promise.resolve(); // an unhandled rejection here would fail the run
  });
});

describe("trackUserMessageSent()", () => {
  it("should send has_attachment true and the model when both are present", () => {
    trackUserMessageSent(true, "anthropic/claude-x");
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith("analytics_track", {
      event: "user_message_sent",
      props: { has_attachment: "true", model: "anthropic/claude-x" },
    });
  });

  it("should send has_attachment false when there is no attachment", () => {
    trackUserMessageSent(false, "anthropic/claude-x");
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith("analytics_track", {
      event: "user_message_sent",
      props: { has_attachment: "false", model: "anthropic/claude-x" },
    });
  });

  it("should omit the model prop when no model is known", () => {
    trackUserMessageSent(false);
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith("analytics_track", {
      event: "user_message_sent",
      props: { has_attachment: "false" },
    });
  });
});

describe("trackUserFirstMessageSent()", () => {
  it("should send user_first_message_sent flagged as a once milestone", () => {
    trackUserFirstMessageSent();
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith("analytics_track", {
      event: "user_first_message_sent",
      props: undefined,
      once: true,
    });
  });
});

describe("trackAgentMessageSent()", () => {
  it("should send agent_message_sent with no props", () => {
    trackAgentMessageSent();
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith("analytics_track", {
      event: "agent_message_sent",
      props: undefined,
    });
  });
});

describe("trackAgentToolUsed()", () => {
  it("should send status ok when the tool run succeeded", () => {
    trackAgentToolUsed("query", false);
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith("analytics_track", {
      event: "agent_tool_used",
      props: { tool: "query", status: "ok" },
    });
  });

  it("should send status error when the tool run failed", () => {
    trackAgentToolUsed("validate", true);
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith("analytics_track", {
      event: "agent_tool_used",
      props: { tool: "validate", status: "error" },
    });
  });
});

describe("trackTransactionFirstAdded()", () => {
  it("should send transaction_first_added flagged as a once milestone", () => {
    trackTransactionFirstAdded();
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith("analytics_track", {
      event: "transaction_first_added",
      props: undefined,
      once: true,
    });
  });
});

describe("trackAttachmentAdded()", () => {
  it("should send attachment_added with the coarse kind", () => {
    trackAttachmentAdded("pdf");
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith("analytics_track", {
      event: "attachment_added",
      props: { kind: "pdf" },
    });
  });
});
