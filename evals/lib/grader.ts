import { getModel, streamSimple } from "@mariozechner/pi-ai";
import type { CheckResult, EvalCase, LedgerAssertion, ToolCallRecord } from "./types";
import type { WorkspaceState } from "./workspace";

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

// ── Outcome grading (ledger & memory state) ─────────────────────────

function parseTransactionBlocks(content: string): string[] {
  // Split on blank lines, keep blocks that start with a date pattern
  return content
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => /^\d{4}-\d{2}-\d{2}\s/.test(b));
}

function blockMatchesAssertion(block: string, assertion: LedgerAssertion): boolean {
  const lower = block.toLowerCase();

  // Payee is always required — check the header line (first line)
  const headerLine = block.split("\n")[0].toLowerCase();
  if (!headerLine.includes(assertion.payee.toLowerCase())) return false;

  if (assertion.amount !== undefined) {
    // Match the amount as a number in the block (e.g., "12.00" or "12")
    const amountStr = Number.isInteger(assertion.amount) ? `${assertion.amount}` : assertion.amount.toFixed(2);
    // Also accept the decimal form (e.g., "12" should match "12.00")
    const amountDec = assertion.amount.toFixed(2);
    if (!lower.includes(amountStr) && !lower.includes(amountDec)) return false;
  }

  if (assertion.currency && !lower.includes(assertion.currency.toLowerCase())) return false;
  if (assertion.account && !lower.includes(assertion.account.toLowerCase())) return false;
  if (assertion.date && !block.startsWith(assertion.date)) return false;
  if (assertion.description && !lower.includes(assertion.description.toLowerCase())) return false;

  return true;
}

export function gradeOutcome(evalCase: EvalCase, state: WorkspaceState): CheckResult[] {
  const checks: CheckResult[] = [];
  const blocks = parseTransactionBlocks(state.ledgerContent);

  if (evalCase.expected.ledger_contains) {
    for (const assertion of evalCase.expected.ledger_contains) {
      const found = blocks.some((b) => blockMatchesAssertion(b, assertion));
      const desc = `payee="${assertion.payee}"${assertion.amount !== undefined ? ` amount=${assertion.amount}` : ""}${assertion.currency ? ` currency=${assertion.currency}` : ""}${assertion.account ? ` account=${assertion.account}` : ""}`;
      checks.push({
        check: `ledger_contains: ${desc}`,
        passed: found,
        detail: found ? `Found matching transaction: ${desc}` : `No matching transaction found for: ${desc}`,
      });
    }
  }

  if (evalCase.expected.ledger_not_contains) {
    for (const assertion of evalCase.expected.ledger_not_contains) {
      const found = blocks.some((b) => blockMatchesAssertion(b, assertion));
      const desc = `payee="${assertion.payee}"`;
      checks.push({
        check: `ledger_not_contains: ${desc}`,
        passed: !found,
        detail: found
          ? `Found transaction that should NOT exist: ${desc}`
          : `Correctly no transaction found for: ${desc}`,
      });
    }
  }

  if (evalCase.expected.memory_contains) {
    const memLower = state.memoryContent.toLowerCase();
    for (const expected of evalCase.expected.memory_contains) {
      const found = memLower.includes(expected.toLowerCase());
      checks.push({
        check: `memory_contains: "${expected}"`,
        passed: found,
        detail: found
          ? `Memory contains "${expected}"`
          : `Memory does NOT contain "${expected}". Content: ${state.memoryContent || "(empty)"}`,
      });
    }
  }

  return checks;
}
