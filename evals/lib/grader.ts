import { getModel, streamSimple } from "@mariozechner/pi-ai";
import type { CheckResult, EvalCase, ToolCallRecord } from "./types.js";

// ── Deterministic grading ────────────────────────────────────────────

export function gradeDeterministic(
  evalCase: EvalCase,
  toolsCalled: ToolCallRecord[],
  agentOutput: string,
): CheckResult[] {
  const checks: CheckResult[] = [];
  const calledNames = [...new Set(toolsCalled.map((t) => t.toolName))];

  if (evalCase.expected.tools_called) {
    for (const expected of evalCase.expected.tools_called) {
      const found = calledNames.includes(expected);
      checks.push({
        check: `tools_called: ${expected}`,
        passed: found,
        detail: found
          ? `"${expected}" was called`
          : `"${expected}" was NOT called. Called: [${calledNames.join(", ")}]`,
      });
    }
  }

  if (evalCase.expected.tools_not_called) {
    for (const forbidden of evalCase.expected.tools_not_called) {
      const found = calledNames.includes(forbidden);
      checks.push({
        check: `tools_not_called: ${forbidden}`,
        passed: !found,
        detail: found
          ? `"${forbidden}" was called but should NOT have been`
          : `"${forbidden}" was correctly not called`,
      });
    }
  }

  if (evalCase.expected.output_contains) {
    const lower = agentOutput.toLowerCase();
    for (const fragment of evalCase.expected.output_contains) {
      const found = lower.includes(fragment.toLowerCase());
      checks.push({
        check: `output_contains: "${fragment}"`,
        passed: found,
        detail: found ? `Output contains "${fragment}"` : `Output does NOT contain "${fragment}"`,
      });
    }
  }

  if (evalCase.expected.output_not_contains) {
    const lower = agentOutput.toLowerCase();
    for (const fragment of evalCase.expected.output_not_contains) {
      const found = lower.includes(fragment.toLowerCase());
      checks.push({
        check: `output_not_contains: "${fragment}"`,
        passed: !found,
        detail: found
          ? `Output contains "${fragment}" but should NOT`
          : `Output correctly does not contain "${fragment}"`,
      });
    }
  }

  return checks;
}

// ── Rubric grading (LLM-as-judge) ───────────────────────────────────

export async function gradeWithRubric(
  evalCase: EvalCase,
  toolsCalled: ToolCallRecord[],
  agentOutput: string,
  judgeProvider: string,
  judgeModel: string,
): Promise<CheckResult> {
  const rubric = evalCase.expected.rubric;
  if (!rubric) {
    return { check: "rubric", passed: true, detail: "No rubric specified" };
  }

  const toolSummary = toolsCalled
    .map((t) => `- ${t.toolName}(${JSON.stringify(t.args)}) → error=${t.isError}`)
    .join("\n");

  const today = new Date().toISOString().slice(0, 10);

  const prompt = `You are an eval judge. Grade whether the agent's behavior satisfies the rubric.

## Current Date
${today}

## Rubric
${rubric}

## Agent Output
${agentOutput || "(no text output)"}

## Tool Calls Made
${toolSummary || "(none)"}

## Instructions
Respond with exactly one line:
- "PASS: <brief reason>" if the rubric is satisfied
- "FAIL: <brief reason>" if the rubric is NOT satisfied

Do not include anything else in your response.`;

  const model = (getModel as any)(judgeProvider, judgeModel);
  const stream = streamSimple(model, {
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
  });
  const result = await stream.result();

  const text = result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  const passed = text.toUpperCase().startsWith("PASS");
  return {
    check: "rubric",
    passed,
    detail: text,
  };
}
