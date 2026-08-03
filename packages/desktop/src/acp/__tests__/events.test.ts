import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { toSessionUpdate } from "../events";

/** pi's event union is wide and mostly irrelevant here; cast the fixtures. */
const ev = (e: unknown): AgentSessionEvent => e as AgentSessionEvent;

const messageUpdate = (assistantMessageEvent: unknown) =>
  ev({ type: "message_update", message: {}, assistantMessageEvent });

describe("toSessionUpdate()", () => {
  describe("assistant text", () => {
    it("should map a text_delta to an agent_message_chunk carrying the delta", () => {
      expect(toSessionUpdate(messageUpdate({ type: "text_delta", delta: "Hello", contentIndex: 0 }))).toEqual({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello" },
      });
    });

    it("should map a thinking_delta to an agent_thought_chunk", () => {
      expect(toSessionUpdate(messageUpdate({ type: "thinking_delta", delta: "hmm", contentIndex: 0 }))).toEqual({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "hmm" },
      });
    });

    // text_end repeats the whole block; emitting it would duplicate everything
    // already streamed as deltas.
    it("should drop text_end so streamed text is not duplicated", () => {
      expect(toSessionUpdate(messageUpdate({ type: "text_end", content: "Hello", contentIndex: 0 }))).toBeNull();
    });

    it("should drop thinking_end", () => {
      expect(toSessionUpdate(messageUpdate({ type: "thinking_end", content: "hmm", contentIndex: 0 }))).toBeNull();
    });

    it("should drop an empty delta rather than emit an empty chunk", () => {
      expect(toSessionUpdate(messageUpdate({ type: "text_delta", delta: "", contentIndex: 0 }))).toBeNull();
    });

    it("should drop stream lifecycle events", () => {
      expect(toSessionUpdate(messageUpdate({ type: "start" }))).toBeNull();
      expect(toSessionUpdate(messageUpdate({ type: "text_start", contentIndex: 0 }))).toBeNull();
      expect(toSessionUpdate(messageUpdate({ type: "toolcall_delta", delta: "{", contentIndex: 0 }))).toBeNull();
      expect(toSessionUpdate(messageUpdate({ type: "done", reason: "stop" }))).toBeNull();
    });
  });

  describe("tool calls", () => {
    it("should open a tool call as in_progress with its label, kind and raw input", () => {
      const event = ev({
        type: "tool_execution_start",
        toolCallId: "call_1",
        toolName: "query",
        args: { query: "balance" },
      });
      expect(toSessionUpdate(event)).toEqual({
        sessionUpdate: "tool_call",
        toolCallId: "call_1",
        title: "Query Ledger",
        kind: "search",
        status: "in_progress",
        rawInput: { query: "balance" },
      });
    });

    it("should complete a successful tool call with its text content", () => {
      const result = { content: [{ type: "text", text: "1,234.00 EUR" }], details: {} };
      const event = ev({ type: "tool_execution_end", toolCallId: "call_1", toolName: "query", result, isError: false });
      expect(toSessionUpdate(event)).toEqual({
        sessionUpdate: "tool_call_update",
        toolCallId: "call_1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "1,234.00 EUR" } }],
        rawOutput: result,
      });
    });

    it("should mark a failed tool call as failed", () => {
      const event = ev({
        type: "tool_execution_end",
        toolCallId: "call_2",
        toolName: "validate",
        result: { content: [{ type: "text", text: "unbalanced" }] },
        isError: true,
      });
      expect(toSessionUpdate(event)).toMatchObject({ status: "failed" });
    });

    it("should carry image content through", () => {
      const event = ev({
        type: "tool_execution_end",
        toolCallId: "c",
        toolName: "extract_text",
        result: { content: [{ type: "image", data: "aGk=", mimeType: "image/png" }] },
        isError: false,
      });
      expect(toSessionUpdate(event)).toMatchObject({
        content: [{ type: "content", content: { type: "image", data: "aGk=", mimeType: "image/png" } }],
      });
    });

    it("should skip malformed content parts instead of failing the update", () => {
      const event = ev({
        type: "tool_execution_end",
        toolCallId: "c",
        toolName: "query",
        result: { content: [null, { type: "text" }, { type: "text", text: "" }, "nope", { type: "text", text: "ok" }] },
        isError: false,
      });
      expect(toSessionUpdate(event)).toMatchObject({
        content: [{ type: "content", content: { type: "text", text: "ok" } }],
      });
    });

    it.each([
      ["a missing result", undefined],
      ["a null result", null],
      ["a non-object result", "oops"],
      ["a result with no content array", { details: {} }],
    ])("should produce empty content for %s", (_label, result) => {
      const event = ev({ type: "tool_execution_end", toolCallId: "c", toolName: "query", result, isError: false });
      expect(toSessionUpdate(event)).toMatchObject({ content: [] });
    });
  });

  describe("session info", () => {
    it("should map a renamed session to a session_info_update", () => {
      expect(toSessionUpdate(ev({ type: "session_info_changed", name: "Groceries" }))).toEqual({
        sessionUpdate: "session_info_update",
        title: "Groceries",
      });
    });

    it("should drop a cleared session name", () => {
      expect(toSessionUpdate(ev({ type: "session_info_changed", name: undefined }))).toBeNull();
    });
  });

  describe("events with no ACP equivalent", () => {
    it.each([
      "agent_start",
      "agent_end",
      "turn_start",
      "turn_end",
      "message_start",
      "message_end",
      "tool_execution_update",
      "queue_update",
      "compaction_start",
      "compaction_end",
      "thinking_level_changed",
      "auto_retry_start",
      "auto_retry_end",
    ])("should drop %s", (type) => {
      expect(toSessionUpdate(ev({ type }))).toBeNull();
    });
  });
});
