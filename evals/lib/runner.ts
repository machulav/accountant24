import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { codingTools } from "@mariozechner/pi-coding-agent";
import {
  addTransactionTool,
  buildSystemPrompt,
  queryTool,
  setBaseDir,
  updateMemoryTool,
  validateTool,
} from "../../src/extension";

const customTools = [validateTool, queryTool, addTransactionTool, updateMemoryTool];

import { gradeDeterministic, gradeOutcome, gradeWithRubric } from "./grader";
import { loadCases } from "./loader";
import type { EvalResult, ToolCallRecord } from "./types";
import { createEvalWorkspace, inspectWorkspace } from "./workspace";

export interface EvalRunConfig {
  provider: string;
  model: string;
  judgeProvider: string;
  judgeModel: string;
  filter?: string;
  onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { type: "start"; total: number }
  | { type: "case_start"; index: number; total: number; id: string }
  | { type: "case_end"; index: number; total: number; id: string; passed: boolean; durationMs: number };

export interface EvalDeps {
  loadCases: typeof loadCases;
  createEvalWorkspace: typeof createEvalWorkspace;
  inspectWorkspace: typeof inspectWorkspace;
  setBaseDir: typeof setBaseDir;
  buildSystemPrompt: typeof buildSystemPrompt;
  getModel: typeof getModel;
  streamSimple: typeof streamSimple;
  customTools: typeof customTools;
  gradeDeterministic: typeof gradeDeterministic;
  gradeOutcome: typeof gradeOutcome;
  gradeWithRubric: typeof gradeWithRubric;
  Agent: typeof Agent;
}

const defaultDeps: EvalDeps = {
  loadCases,
  createEvalWorkspace,
  inspectWorkspace,
  setBaseDir,
  buildSystemPrompt,
  getModel,
  streamSimple,
  customTools,
  gradeDeterministic,
  gradeOutcome,
  gradeWithRubric,
  Agent,
};

export async function runEval(config: EvalRunConfig, deps: EvalDeps = defaultDeps): Promise<EvalResult[]> {
  const cases = deps.loadCases(config.filter);
  const results: EvalResult[] = [];
  const notify = config.onProgress;

  notify?.({ type: "start", total: cases.length });

  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i];
    const start = Date.now();
    const workspace = deps.createEvalWorkspace(evalCase);

    notify?.({ type: "case_start", index: i, total: cases.length, id: evalCase.id });

    try {
      deps.setBaseDir(workspace.home);

      const systemPrompt = await deps.buildSystemPrompt();

      const model = (deps.getModel as any)(config.provider, config.model);
      const agent = new deps.Agent({
        initialState: {
          systemPrompt,
          model,
          tools: [...codingTools, ...deps.customTools] as any,
        },
        streamFn: deps.streamSimple,
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
                model: config.model,
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
      const checks = deps.gradeDeterministic(evalCase, toolsCalled, agentOutput);

      // Outcome grading (must run before cleanup since it reads workspace files)
      const workspaceState = deps.inspectWorkspace(workspace);
      checks.push(...deps.gradeOutcome(evalCase, workspaceState));

      if (evalCase.grading === "rubric" && evalCase.expected.rubric) {
        const rubricCheck = await deps.gradeWithRubric(
          evalCase,
          toolsCalled,
          agentOutput,
          config.judgeProvider,
          config.judgeModel,
        );
        checks.push(rubricCheck);
      }

      const passed = checks.every((c) => c.passed);
      const durationMs = Date.now() - start;
      results.push({
        id: evalCase.id,
        passed,
        checks,
        toolsCalled,
        agentOutput,
        durationMs,
        sourceFile: evalCase.sourceFile,
      });
      notify?.({ type: "case_end", index: i, total: cases.length, id: evalCase.id, passed, durationMs });
    } catch (err: any) {
      if (!results.some((r) => r.id === evalCase.id)) {
        const durationMs = Date.now() - start;
        results.push({
          id: evalCase.id,
          passed: false,
          checks: [],
          toolsCalled: [],
          agentOutput: "",
          durationMs,
          error: err.message ?? String(err),
          sourceFile: evalCase.sourceFile,
        });
        notify?.({ type: "case_end", index: i, total: cases.length, id: evalCase.id, passed: false, durationMs });
      }
    } finally {
      workspace.cleanup();
    }
  }

  return results;
}
