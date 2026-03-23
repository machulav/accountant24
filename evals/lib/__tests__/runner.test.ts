import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { EvalDeps, EvalRunConfig } from "../runner.js";
import { runEval } from "../runner.js";
import type { CheckResult, LoadedEvalCase } from "../types.js";

// ── Mutable control variables ───────────────────────────────────────

let mockCases: LoadedEvalCase[] = [];
let mockGradeDeterministicResult: CheckResult[] = [];
let mockGradeOutcomeResult: CheckResult[] = [];
let mockGradeOutcomeCalled = false;
let mockGradeWithRubricResult: CheckResult = { check: "rubric", passed: true, detail: "ok" };
let mockGradeWithRubricCalled = false;
let mockGradeWithRubricArgs: unknown[] = [];
let mockInspectWorkspaceCalled = false;
let mockWorkspaceHome = "/tmp/fake-workspace";
const mockWorkspaceCleanup = mock(() => {});
let capturedSetBaseDir: string | undefined;
let capturedGetModelArgs: unknown[] = [];
let capturedLoadCasesFilter: string | undefined;
let capturedAppendMessages: any[] = [];
let capturedPromptArg: string | undefined;
let mockAgentMessages: any[] = [];
let mockSubscribeCallback: ((event: any) => void) | undefined;
let mockPromptShouldThrow: Error | null = null;
let mockToolEvents: any[] = [];

// ── Mock Agent class ────────────────────────────────────────────────

class MockAgent {
  constructor() {
    capturedAppendMessages = [];
    capturedPromptArg = undefined;
  }
  subscribe(fn: (event: any) => void) {
    mockSubscribeCallback = fn;
  }
  appendMessage(msg: any) {
    capturedAppendMessages.push(msg);
  }
  async prompt(content: string) {
    capturedPromptArg = content;
    if (mockSubscribeCallback) {
      for (const event of mockToolEvents) {
        mockSubscribeCallback(event);
      }
    }
    if (mockPromptShouldThrow) {
      throw mockPromptShouldThrow;
    }
  }
  async waitForIdle() {}
  get state() {
    return { messages: mockAgentMessages };
  }
}

// ── Build mock deps ─────────────────────────────────────────────────

function makeDeps(): EvalDeps {
  return {
    loadCases: ((filter?: string) => {
      capturedLoadCasesFilter = filter;
      return mockCases;
    }) as any,
    createEvalWorkspace: (() => ({
      home: mockWorkspaceHome,
      ledgerDir: `${mockWorkspaceHome}/ledger`,
      memoryPath: `${mockWorkspaceHome}/memory.json`,
      cleanup: mockWorkspaceCleanup,
    })) as any,
    setBaseDir: ((dir: string) => {
      capturedSetBaseDir = dir;
    }) as any,
    loadSystemPromptContext: (async () => ({ context: "mock" })) as any,
    getSystemPrompt: (() => "mock system prompt") as any,
    getModel: ((...args: unknown[]) => {
      capturedGetModelArgs = args;
      return { id: "mock-model" };
    }) as any,
    streamSimple: (() => {}) as any,
    customTools: [{ name: "mock-tool" }] as any,
    inspectWorkspace: (() => {
      mockInspectWorkspaceCalled = true;
      return { ledgerContent: "", memoryFacts: [] };
    }) as any,
    gradeDeterministic: (() => [...mockGradeDeterministicResult]) as any,
    gradeOutcome: (() => {
      mockGradeOutcomeCalled = true;
      return [...mockGradeOutcomeResult];
    }) as any,
    gradeWithRubric: (async (...args: unknown[]) => {
      mockGradeWithRubricCalled = true;
      mockGradeWithRubricArgs = args;
      return mockGradeWithRubricResult;
    }) as any,
    Agent: MockAgent as any,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function makeCase(overrides?: Partial<LoadedEvalCase>): LoadedEvalCase {
  return {
    id: "test-001",
    input: { messages: [{ role: "user", content: "hello" }] },
    expected: {},
    grading: "deterministic",
    metadata: { category: "test", tags: [], difficulty: "easy" },
    sourceFile: "test.jsonl",
    ...overrides,
  };
}

const defaultConfig: EvalRunConfig = {
  provider: "test-provider",
  model: "test-model",
  judgeProvider: "test-judge-provider",
  judgeModel: "test-judge-model",
};

// ── Reset state ─────────────────────────────────────────────────────

beforeEach(() => {
  mockCases = [];
  mockGradeDeterministicResult = [];
  mockGradeOutcomeResult = [];
  mockGradeOutcomeCalled = false;
  mockGradeWithRubricResult = { check: "rubric", passed: true, detail: "ok" };
  mockGradeWithRubricCalled = false;
  mockGradeWithRubricArgs = [];
  mockInspectWorkspaceCalled = false;
  mockWorkspaceHome = "/tmp/fake-workspace";
  mockWorkspaceCleanup.mockClear();
  capturedSetBaseDir = undefined;
  capturedGetModelArgs = [];
  capturedLoadCasesFilter = undefined;
  capturedAppendMessages = [];
  capturedPromptArg = undefined;
  mockAgentMessages = [];
  mockSubscribeCallback = undefined;
  mockPromptShouldThrow = null;
  mockToolEvents = [];
});

// ── Tests ───────────────────────────────────────────────────────────

describe("runEval()", () => {
  describe("empty cases", () => {
    it("should return empty array when no cases loaded", async () => {
      mockCases = [];
      const results = await runEval(defaultConfig, makeDeps());
      expect(results).toEqual([]);
    });
  });

  describe("happy path (deterministic)", () => {
    it("should return passing result when all checks pass", async () => {
      mockCases = [makeCase()];
      mockGradeDeterministicResult = [{ check: "tools_called: query", passed: true, detail: "called" }];
      mockAgentMessages = [{ role: "assistant", content: [{ type: "text", text: "done" }] }];

      const results = await runEval(defaultConfig, makeDeps());
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
    });

    it("should return failing result when any check fails", async () => {
      mockCases = [makeCase()];
      mockGradeDeterministicResult = [
        { check: "tools_called: query", passed: true, detail: "called" },
        { check: "tools_called: validate", passed: false, detail: "NOT called" },
      ];

      const results = await runEval(defaultConfig, makeDeps());
      expect(results[0].passed).toBe(false);
    });

    it("should set id, durationMs, sourceFile, agentOutput on result", async () => {
      mockCases = [makeCase({ id: "my-case", sourceFile: "my-file.jsonl" })];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [{ role: "assistant", content: [{ type: "text", text: "response text" }] }];

      const results = await runEval(defaultConfig, makeDeps());
      expect(results[0].id).toBe("my-case");
      expect(results[0].sourceFile).toBe("my-file.jsonl");
      expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(results[0].agentOutput).toBe("response text");
    });
  });

  describe("rubric grading", () => {
    it("should call gradeWithRubric when grading is 'rubric' and rubric exists", async () => {
      mockCases = [makeCase({ grading: "rubric", expected: { rubric: "check something" } })];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [];

      await runEval(defaultConfig, makeDeps());
      expect(mockGradeWithRubricCalled).toBe(true);
    });

    it("should NOT call gradeWithRubric when grading is 'rubric' but no rubric", async () => {
      mockCases = [makeCase({ grading: "rubric", expected: {} })];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [];

      await runEval(defaultConfig, makeDeps());
      expect(mockGradeWithRubricCalled).toBe(false);
    });

    it("should NOT call gradeWithRubric when grading is 'deterministic'", async () => {
      mockCases = [makeCase({ grading: "deterministic", expected: { rubric: "some rubric" } })];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [];

      await runEval(defaultConfig, makeDeps());
      expect(mockGradeWithRubricCalled).toBe(false);
    });

    it("should append rubric check to deterministic checks", async () => {
      mockCases = [makeCase({ grading: "rubric", expected: { rubric: "check it" } })];
      mockGradeDeterministicResult = [{ check: "det", passed: true, detail: "ok" }];
      mockGradeWithRubricResult = { check: "rubric", passed: true, detail: "rubric ok" };
      mockAgentMessages = [];

      const results = await runEval(defaultConfig, makeDeps());
      expect(results[0].checks).toHaveLength(2);
      expect(results[0].checks[1].check).toBe("rubric");
    });

    it("should pass judgeProvider and judgeModel to gradeWithRubric", async () => {
      mockCases = [makeCase({ grading: "rubric", expected: { rubric: "test" } })];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [];

      await runEval(defaultConfig, makeDeps());
      expect(mockGradeWithRubricArgs[3]).toBe("test-judge-provider");
      expect(mockGradeWithRubricArgs[4]).toBe("test-judge-model");
    });
  });

  describe("tool call capture", () => {
    it("should capture tool calls from start+end event pairs", async () => {
      mockCases = [makeCase()];
      mockGradeDeterministicResult = [];
      mockToolEvents = [
        { type: "tool_execution_start", toolCallId: "tc-1", toolName: "query", args: { q: "test" } },
        { type: "tool_execution_end", toolCallId: "tc-1", result: { data: "ok" }, isError: false },
      ];
      mockAgentMessages = [];

      const results = await runEval(defaultConfig, makeDeps());
      expect(results[0].toolsCalled).toHaveLength(1);
      expect(results[0].toolsCalled[0]).toEqual({
        toolCallId: "tc-1",
        toolName: "query",
        args: { q: "test" },
        result: { data: "ok" },
        isError: false,
      });
    });

    it("should ignore tool_execution_end without matching start", async () => {
      mockCases = [makeCase()];
      mockGradeDeterministicResult = [];
      mockToolEvents = [{ type: "tool_execution_end", toolCallId: "orphan-1", result: {}, isError: false }];
      mockAgentMessages = [];

      const results = await runEval(defaultConfig, makeDeps());
      expect(results[0].toolsCalled).toHaveLength(0);
    });

    it("should capture multiple tool calls", async () => {
      mockCases = [makeCase()];
      mockGradeDeterministicResult = [];
      mockToolEvents = [
        { type: "tool_execution_start", toolCallId: "tc-1", toolName: "query", args: {} },
        { type: "tool_execution_end", toolCallId: "tc-1", result: {}, isError: false },
        { type: "tool_execution_start", toolCallId: "tc-2", toolName: "add_transaction", args: {} },
        { type: "tool_execution_end", toolCallId: "tc-2", result: {}, isError: false },
      ];
      mockAgentMessages = [];

      const results = await runEval(defaultConfig, makeDeps());
      expect(results[0].toolsCalled).toHaveLength(2);
      expect(results[0].toolsCalled[0].toolName).toBe("query");
      expect(results[0].toolsCalled[1].toolName).toBe("add_transaction");
    });
  });

  describe("history injection", () => {
    it("should inject history via appendMessage for multi-turn conversations", async () => {
      mockCases = [
        makeCase({
          input: {
            messages: [
              { role: "user", content: "first" },
              { role: "assistant", content: "reply" },
              { role: "user", content: "second" },
            ],
          },
        }),
      ];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [];

      await runEval(defaultConfig, makeDeps());
      expect(capturedAppendMessages).toHaveLength(2);
      expect(capturedPromptArg).toBe("second");
    });

    it("should format user messages with string content", async () => {
      mockCases = [
        makeCase({
          input: {
            messages: [
              { role: "user", content: "history msg" },
              { role: "user", content: "prompt" },
            ],
          },
        }),
      ];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [];

      await runEval(defaultConfig, makeDeps());
      expect(capturedAppendMessages[0].role).toBe("user");
      expect(capturedAppendMessages[0].content).toBe("history msg");
    });

    it("should format assistant messages with structured content and metadata", async () => {
      mockCases = [
        makeCase({
          input: {
            messages: [
              { role: "assistant", content: "I am an assistant" },
              { role: "user", content: "prompt" },
            ],
          },
        }),
      ];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [];

      await runEval(defaultConfig, makeDeps());
      const msg = capturedAppendMessages[0];
      expect(msg.role).toBe("assistant");
      expect(msg.content).toEqual([{ type: "text", text: "I am an assistant" }]);
      expect(msg.model).toBe("test-model");
      expect(msg.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
      expect(msg.stopReason).toBe("stop");
    });

    it("should handle single-message input (no history)", async () => {
      mockCases = [makeCase({ input: { messages: [{ role: "user", content: "only one" }] } })];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [];

      await runEval(defaultConfig, makeDeps());
      expect(capturedAppendMessages).toHaveLength(0);
      expect(capturedPromptArg).toBe("only one");
    });
  });

  describe("output extraction", () => {
    it("should extract text from new assistant messages, skipping injected history", async () => {
      mockCases = [
        makeCase({
          input: {
            messages: [
              { role: "user", content: "first" },
              { role: "assistant", content: "old reply" },
              { role: "user", content: "second" },
            ],
          },
        }),
      ];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [
        { role: "user", content: "first" },
        { role: "assistant", content: [{ type: "text", text: "old reply" }] },
        { role: "user", content: "second" },
        { role: "assistant", content: [{ type: "text", text: "new reply" }] },
      ];

      const results = await runEval(defaultConfig, makeDeps());
      expect(results[0].agentOutput).toBe("new reply");
    });

    it("should handle messages with no text content blocks", async () => {
      mockCases = [makeCase()];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [{ role: "assistant", content: [{ type: "tool_use", name: "query", input: {} }] }];

      const results = await runEval(defaultConfig, makeDeps());
      expect(results[0].agentOutput).toBe("");
    });

    it("should join multiple text blocks with newline", async () => {
      mockCases = [makeCase()];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [
        { role: "assistant", content: [{ type: "text", text: "line1" }] },
        { role: "assistant", content: [{ type: "text", text: "line2" }] },
      ];

      const results = await runEval(defaultConfig, makeDeps());
      expect(results[0].agentOutput).toBe("line1\nline2");
    });

    it("should slice from 0 when no history messages", async () => {
      mockCases = [makeCase({ input: { messages: [{ role: "user", content: "only" }] } })];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [
        { role: "user", content: "only" },
        { role: "assistant", content: [{ type: "text", text: "reply" }] },
      ];

      const results = await runEval(defaultConfig, makeDeps());
      expect(results[0].agentOutput).toBe("reply");
    });

    it("should handle assistant message with null content gracefully", async () => {
      mockCases = [makeCase()];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [{ role: "assistant", content: null }];

      const results = await runEval(defaultConfig, makeDeps());
      expect(results[0].agentOutput).toBe("");
    });
  });

  describe("error handling", () => {
    it("should catch errors and return failed result with error message", async () => {
      mockCases = [makeCase()];
      mockPromptShouldThrow = new Error("LLM timeout");

      const results = await runEval(defaultConfig, makeDeps());
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].error).toBe("LLM timeout");
      expect(results[0].checks).toEqual([]);
      expect(results[0].toolsCalled).toEqual([]);
      expect(results[0].agentOutput).toBe("");
    });

    it("should use String(err) when error has no message property", async () => {
      mockCases = [makeCase()];
      const err = new Error();
      err.message = undefined as any;
      mockPromptShouldThrow = err;

      const results = await runEval(defaultConfig, makeDeps());
      expect(typeof results[0].error).toBe("string");
    });

    it("should not push duplicate result when id already exists from prior case", async () => {
      // Two cases with same id: first succeeds, second throws.
      // The catch guard `!results.some(r => r.id === evalCase.id)` prevents duplicate.
      mockCases = [makeCase({ id: "dup-id" }), makeCase({ id: "dup-id" })];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [];

      let promptCallCount = 0;
      const deps = makeDeps();
      deps.Agent = class {
        subscribe() {}
        appendMessage() {}
        async prompt() {
          promptCallCount++;
          if (promptCallCount === 2) {
            throw new Error("second call fails");
          }
        }
        async waitForIdle() {}
        get state() {
          return { messages: mockAgentMessages };
        }
      } as any;

      const results = await runEval(defaultConfig, deps);
      // Only 1 result despite 2 cases — the catch block skipped the duplicate
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("dup-id");
      expect(results[0].passed).toBe(true); // from the first successful run
    });
  });

  describe("cleanup", () => {
    it("should call workspace.cleanup() on success", async () => {
      mockCases = [makeCase()];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [];

      await runEval(defaultConfig, makeDeps());
      expect(mockWorkspaceCleanup).toHaveBeenCalledTimes(1);
    });

    it("should call workspace.cleanup() on error", async () => {
      mockCases = [makeCase()];
      mockPromptShouldThrow = new Error("boom");

      await runEval(defaultConfig, makeDeps());
      expect(mockWorkspaceCleanup).toHaveBeenCalledTimes(1);
    });
  });

  describe("config propagation", () => {
    it("should pass filter to loadCases", async () => {
      mockCases = [];
      await runEval({ ...defaultConfig, filter: "my-filter" }, makeDeps());
      expect(capturedLoadCasesFilter).toBe("my-filter");
    });

    it("should pass undefined filter to loadCases when not set", async () => {
      mockCases = [];
      await runEval({ ...defaultConfig, filter: undefined }, makeDeps());
      expect(capturedLoadCasesFilter).toBeUndefined();
    });

    it("should pass provider/model to getModel", async () => {
      mockCases = [makeCase()];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [];

      await runEval(defaultConfig, makeDeps());
      expect(capturedGetModelArgs[0]).toBe("test-provider");
      expect(capturedGetModelArgs[1]).toBe("test-model");
    });

    it("should call setBaseDir with workspace home", async () => {
      mockWorkspaceHome = "/custom/workspace";
      mockCases = [makeCase()];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [];

      await runEval(defaultConfig, makeDeps());
      expect(capturedSetBaseDir).toBe("/custom/workspace");
    });
  });

  describe("outcome grading", () => {
    it("should call inspectWorkspace and gradeOutcome for every case", async () => {
      mockCases = [makeCase()];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [];

      await runEval(defaultConfig, makeDeps());
      expect(mockInspectWorkspaceCalled).toBe(true);
      expect(mockGradeOutcomeCalled).toBe(true);
    });

    it("should include outcome checks in results", async () => {
      mockCases = [makeCase()];
      mockGradeDeterministicResult = [{ check: "det", passed: true, detail: "ok" }];
      mockGradeOutcomeResult = [{ check: "ledger_contains: payee=Starbucks", passed: true, detail: "found" }];
      mockAgentMessages = [];

      const results = await runEval(defaultConfig, makeDeps());
      expect(results[0].checks).toHaveLength(2);
      expect(results[0].checks[1].check).toContain("ledger_contains");
    });

    it("should fail overall when outcome check fails", async () => {
      mockCases = [makeCase()];
      mockGradeDeterministicResult = [];
      mockGradeOutcomeResult = [{ check: "ledger_contains: payee=Starbucks", passed: false, detail: "not found" }];
      mockAgentMessages = [];

      const results = await runEval(defaultConfig, makeDeps());
      expect(results[0].passed).toBe(false);
    });
  });

  describe("multiple cases", () => {
    it("should process all cases and return results for each", async () => {
      mockCases = [
        makeCase({ id: "case-a", sourceFile: "a.jsonl" }),
        makeCase({ id: "case-b", sourceFile: "b.jsonl" }),
      ];
      mockGradeDeterministicResult = [];
      mockAgentMessages = [];

      const results = await runEval(defaultConfig, makeDeps());
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe("case-a");
      expect(results[1].id).toBe("case-b");
    });
  });
});
