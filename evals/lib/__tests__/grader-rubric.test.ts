import { describe, expect, it, mock } from "bun:test";
import { makeCase as _makeCase, makeTool } from "./helpers";

let mockJudgeResponse = "PASS: looks good";
let lastPrompt = "";

mock.module("@mariozechner/pi-ai", () => ({
  getModel: () => ({}),
  streamSimple: (_model: unknown, opts: { messages: { content: string }[] }) => {
    lastPrompt = opts.messages[0]?.content ?? "";
    return {
      result: async () => ({
        content: [{ type: "text", text: mockJudgeResponse }],
      }),
    };
  },
}));

const { gradeWithRubric } = await import("../grader.js");

const makeCase = (expected: Parameters<typeof _makeCase>[0]["expected"]) => _makeCase({ expected, grading: "rubric" });

describe("gradeWithRubric()", () => {
  it("should return pass with detail when no rubric specified", async () => {
    const evalCase = makeCase({});
    const result = await gradeWithRubric(evalCase, [], "", "test", "test");
    expect(result.check).toBe("rubric");
    expect(result.passed).toBe(true);
    expect(result.detail).toBe("No rubric specified");
  });

  it("should return pass when judge responds with PASS", async () => {
    mockJudgeResponse = "PASS: agent correctly used query tool";
    const evalCase = makeCase({ rubric: "Agent should use query" });
    const result = await gradeWithRubric(evalCase, [makeTool("query")], "balance is $100", "test", "test");
    expect(result.passed).toBe(true);
    expect(result.detail).toBe("PASS: agent correctly used query tool");
  });

  it("should return fail when judge responds with FAIL", async () => {
    mockJudgeResponse = "FAIL: agent did not use query tool";
    const evalCase = makeCase({ rubric: "Agent should use query" });
    const result = await gradeWithRubric(evalCase, [], "I don't know", "test", "test");
    expect(result.passed).toBe(false);
    expect(result.detail).toBe("FAIL: agent did not use query tool");
  });

  it("should match PASS case-insensitively", async () => {
    mockJudgeResponse = "Pass: it works";
    const evalCase = makeCase({ rubric: "test rubric" });
    const result = await gradeWithRubric(evalCase, [], "", "test", "test");
    expect(result.passed).toBe(true);
  });

  it("should treat any response not starting with PASS as failure", async () => {
    mockJudgeResponse = "The agent failed to meet requirements";
    const evalCase = makeCase({ rubric: "test rubric" });
    const result = await gradeWithRubric(evalCase, [], "", "test", "test");
    expect(result.passed).toBe(false);
  });

  it("should always set check to 'rubric'", async () => {
    mockJudgeResponse = "PASS: ok";
    const evalCase = makeCase({ rubric: "test rubric" });
    const result = await gradeWithRubric(evalCase, [], "", "test", "test");
    expect(result.check).toBe("rubric");
  });

  it("should trim whitespace from judge response", async () => {
    mockJudgeResponse = "  PASS: trimmed  \n";
    const evalCase = makeCase({ rubric: "test rubric" });
    const result = await gradeWithRubric(evalCase, [], "", "test", "test");
    expect(result.passed).toBe(true);
    expect(result.detail).toBe("PASS: trimmed");
  });

  it("should handle multi-segment text content from judge", async () => {
    mockJudgeResponse = "FAIL: missing tool call";
    const evalCase = makeCase({ rubric: "Should call query" });
    const result = await gradeWithRubric(evalCase, [], "", "test", "test");
    expect(result.passed).toBe(false);
  });

  it("should handle empty agent output gracefully", async () => {
    mockJudgeResponse = "PASS: correctly handled";
    const evalCase = makeCase({ rubric: "Should handle empty output" });
    const result = await gradeWithRubric(evalCase, [], "", "test", "test");
    expect(result.passed).toBe(true);
  });

  it("should handle empty tool calls gracefully", async () => {
    mockJudgeResponse = "PASS: no tools needed";
    const evalCase = makeCase({ rubric: "No tools required" });
    const result = await gradeWithRubric(evalCase, [], "output", "test", "test");
    expect(result.passed).toBe(true);
  });

  it("should include current date in judge prompt", async () => {
    mockJudgeResponse = "PASS: date checked";
    const evalCase = makeCase({ rubric: "Date should be yesterday" });
    await gradeWithRubric(evalCase, [], "", "test", "test");
    const today = new Date().toISOString().slice(0, 10);
    expect(lastPrompt).toContain("## Current Date");
    expect(lastPrompt).toContain(today);
  });
});
