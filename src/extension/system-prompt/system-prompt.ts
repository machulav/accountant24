import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAccounts, loadFacts, loadPayees } from "../context.js";

export interface SystemPromptContext {
  today: string;
  facts: string[];
  accounts: string[];
  payees: string[];
}

// ── Static prefix (loaded from system.md, cached by Claude API) ─────

const STATIC_PREFIX = readFileSync(join(import.meta.dirname, "system.md"), "utf-8");

// ── Public API ────────────────────────────────────────────────────────

export async function buildSystemPrompt(): Promise<string> {
  const today = new Date().toISOString().split("T")[0];
  const [facts, accounts, payees] = await Promise.all([loadFacts(), loadAccounts(), loadPayees()]);
  return getSystemPrompt({ today, facts, accounts, payees });
}

export function getSystemPrompt(ctx: SystemPromptContext): string {
  const parts: string[] = [STATIC_PREFIX];

  parts.push(`\n<session>\nToday's date: ${ctx.today}\n</session>`);

  if (ctx.facts.length > 0) {
    parts.push(`\n<memory>\nUser facts:\n${ctx.facts.map((f) => `- ${f}`).join("\n")}\n</memory>`);
  }

  if (ctx.accounts.length > 0) {
    parts.push(`\n<accounts>\nKnown accounts:\n${ctx.accounts.join("\n")}\n</accounts>`);
  }

  if (ctx.payees.length > 0) {
    parts.push(`\n<known-payees>\nAll payees in the journal:\n${ctx.payees.join("\n")}\n</known-payees>`);
  }

  return parts.join("");
}
