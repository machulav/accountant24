import { afterAll, expect, test } from "bun:test";
import type { EvalResult, ToolCallRecord } from "./lib/types.js";

// ── Env config ───────────────────────────────────────────────────────

const EVAL_PROVIDER = process.env.EVAL_PROVIDER ?? "anthropic";
const EVAL_MODEL = process.env.EVAL_MODEL ?? "claude-sonnet-4-6";
const EVAL_JUDGE_PROVIDER = process.env.EVAL_JUDGE_PROVIDER ?? EVAL_PROVIDER;
const EVAL_JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? EVAL_MODEL;
const EVAL_TIMEOUT = Number(process.env.EVAL_TIMEOUT ?? "60000");
const EVAL_FILTER = process.env.EVAL_FILTER;

// ── Imports ──────────────────────────────────────────────────────────

import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { getSystemPrompt, loadSystemPromptContext } from "../src/core/agent/system-prompt.js";
import { setBaseDir } from "../src/core/config.js";
import { createTools } from "../src/core/tools/index.js";
import { gradeDeterministic, gradeWithRubric } from "./lib/grader.js";
import { loadCases } from "./lib/loader.js";
import { formatResults } from "./lib/reporter.js";
import { createEvalWorkspace } from "./lib/workspace.js";

// ── Load cases ───────────────────────────────────────────────────────

const cases = loadCases(EVAL_FILTER);
const results: EvalResult[] = [];

// ── Run each case ────────────────────────────────────────────────────

const printedFiles = new Set<string>();

for (const evalCase of cases) {
  test(
    evalCase.id,
    async () => {
      if (!printedFiles.has(evalCase.sourceFile)) {
        printedFiles.add(evalCase.sourceFile);
        console.log(`\n  ── ${evalCase.sourceFile} ${"─".repeat(Math.max(0, 56 - evalCase.sourceFile.length))}\n`);
      }
      const start = Date.now();
      const workspace = createEvalWorkspace(evalCase);

      try {
        // Point config paths to this workspace
        setBaseDir(workspace.home);

        // Build system prompt from workspace state
        const context = await loadSystemPromptContext();
        const systemPrompt = getSystemPrompt(context);

        // Create agent
        const model = (getModel as any)(EVAL_PROVIDER, EVAL_MODEL);
        const agent = new Agent({
          initialState: {
            systemPrompt,
            model,
            tools: createTools(),
          },
          streamFn: streamSimple,
        });

        // Capture tool calls
        const toolsCalled: ToolCallRecord[] = [];
        const pendingCalls = new Map<string, { toolName: string; args: unknown }>();

        agent.subscribe((event: any) => {
          if (event.type === "tool_execution_start") {
            pendingCalls.set(event.toolCallId, {
              toolName: event.toolName,
              args: event.args,
            });
          }
          if (event.type === "tool_execution_end") {
            const pending = pendingCalls.get(event.toolCallId);
            if (pending) {
              toolsCalled.push({
                toolCallId: event.toolCallId,
                toolName: pending.toolName,
                args: pending.args,
                result: event.result,
                isError: event.isError,
              });
              pendingCalls.delete(event.toolCallId);
            }
          }
        });

        // Inject conversation history (all but last message)
        const messages = evalCase.input.messages;
        const historyMessages = messages.slice(0, -1);
        const lastMessage = messages[messages.length - 1];

        for (const msg of historyMessages) {
          agent.appendMessage({
            role: msg.role === "user" ? "user" : "assistant",
            content: msg.role === "user" ? msg.content : [{ type: "text", text: msg.content }],
            timestamp: Date.now(),
            ...(msg.role === "assistant"
              ? {
                  api: "anthropic" as any,
                  provider: "anthropic" as any,
                  model: EVAL_MODEL,
                  usage: { inputTokens: 0, outputTokens: 0 },
                  stopReason: "stop" as any,
                }
              : {}),
          } as any);
        }

        // Prompt with last message
        await agent.prompt(lastMessage.content);
        await agent.waitForIdle();

        // Extract agent text output (only from NEW responses, not injected history)
        const allMessages = agent.state.messages;
        const newAgentMessages = allMessages
          .slice(historyMessages.length > 0 ? historyMessages.length + 1 : 0)
          .filter((m: any) => m.role === "assistant");
        const agentOutput = newAgentMessages
          .flatMap((m: any) => m.content?.filter((c: any) => c.type === "text")?.map((c: any) => c.text) ?? [])
          .join("\n");

        // Grade
        const checks = gradeDeterministic(evalCase, toolsCalled, agentOutput);

        if (evalCase.grading === "rubric" && evalCase.expected.rubric) {
          const rubricCheck = await gradeWithRubric(
            evalCase,
            toolsCalled,
            agentOutput,
            EVAL_JUDGE_PROVIDER,
            EVAL_JUDGE_MODEL,
          );
          checks.push(rubricCheck);
        }

        const passed = checks.every((c) => c.passed);
        results.push({
          id: evalCase.id,
          passed,
          checks,
          toolsCalled,
          agentOutput,
          durationMs: Date.now() - start,
          sourceFile: evalCase.sourceFile,
        });

        // Fail the test with the first failing check
        const firstFail = checks.find((c) => !c.passed);
        if (firstFail) {
          expect.unreachable(`${firstFail.check}: ${firstFail.detail}`);
        }
      } catch (err: any) {
        // Only push if not already pushed (i.e., unexpected error before grading)
        if (!results.some((r) => r.id === evalCase.id)) {
          results.push({
            id: evalCase.id,
            passed: false,
            checks: [],
            toolsCalled: [],
            agentOutput: "",
            durationMs: Date.now() - start,
            error: err.message ?? String(err),
            sourceFile: evalCase.sourceFile,
          });
        }
        throw err;
      } finally {
        workspace.cleanup();
      }
    },
    EVAL_TIMEOUT,
  );
}

// ── Summary ──────────────────────────────────────────────────────────

afterAll(() => {
  if (results.length > 0) {
    console.log(
      formatResults(results, {
        evalModel: EVAL_MODEL,
        evalProvider: EVAL_PROVIDER,
        judgeModel: EVAL_JUDGE_MODEL,
        judgeProvider: EVAL_JUDGE_PROVIDER,
      }),
    );
  }
});
