import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getMemory, listAccounts, listPayees, listTags } from "../data";

export interface SystemPromptContext {
  today: string;
  memory: string;
  accounts: string[];
  payees: string[];
  tags: string[];
}

// ── Static prefix (loaded from system.md, cached by Claude API) ─────

const STATIC_PREFIX = readFileSync(join(import.meta.dirname, "system.md"), "utf-8");

// ── Public API ────────────────────────────────────────────────────────

export async function buildSystemPrompt(): Promise<string> {
  const today = new Date().toISOString().split("T")[0];
  const [memory, accounts, payees, tags] = await Promise.all([getMemory(), listAccounts(), listPayees(), listTags()]);
  return getSystemPrompt({ today, memory, accounts, payees, tags });
}

export function getSystemPrompt(ctx: SystemPromptContext): string {
  const parts: string[] = [STATIC_PREFIX];

  parts.push(`\n<session>\nToday's date: ${ctx.today}\n</session>`);

  if (ctx.memory) {
    parts.push(`\n<memory>\n${ctx.memory}\n</memory>`);
  }

  parts.push(
    ctx.accounts.length > 0
      ? `\n<accounts>\nAll known accounts:\n${ctx.accounts.join("\n")}\n</accounts>`
      : `\n<accounts>\nNo accounts found.\n</accounts>`,
  );

  parts.push(
    ctx.payees.length > 0
      ? `\n<payees>\nAll known payees:\n${ctx.payees.join("\n")}\n</payees>`
      : `\n<payees>\nNo payees found.\n</payees>`,
  );

  parts.push(
    ctx.tags.length > 0
      ? `\n<tags>\nAll known tags:\n${ctx.tags.join("\n")}\n</tags>`
      : `\n<tags>\nNo tags found.\n</tags>`,
  );

  return parts.join("");
}
