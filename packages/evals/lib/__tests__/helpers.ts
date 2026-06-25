import type { EvalCase, EvalResult, ToolCallRecord } from "../types";

export function makeCase(overrides?: Partial<EvalCase> & { expected?: EvalCase["expected"] }): EvalCase {
  return {
    id: "test-001",
    input: { messages: [{ role: "user", content: "test" }] },
    expected: {},
    grading: "deterministic",
    metadata: { category: "test", tags: [], difficulty: "easy" },
    ...overrides,
  };
}

export function makeResult(overrides: Partial<EvalResult> & { id: string }): EvalResult {
  return {
    passed: true,
    checks: [],
    toolsCalled: [],
    agentOutput: "",
    durationMs: 100,
    sourceFile: "test.jsonl",
    ...overrides,
  };
}

export function makeTool(name: string): ToolCallRecord {
  return { toolCallId: `id-${name}`, toolName: name, args: {}, result: {}, isError: false };
}
