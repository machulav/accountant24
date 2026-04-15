import { listAccounts, listPayees, listTags } from "../ledger";
import { getMemory } from "../memory";
// Text import so `bun build --compile` inlines system.md into the binary.
// @ts-expect-error — TS lib doesn't ship types for text import attributes yet
import systemMdText from "./system.md" with { type: "text" };

export interface ToolPromptMeta {
  name: string;
  snippet: string;
  guidelines?: string[];
}

export interface SystemPromptContext {
  today: string;
  memory: string;
  accounts: string[];
  payees: string[];
  tags: string[];
  tools: ToolPromptMeta[];
}

// ── Static prefix (loaded from system.md, cached by Claude API) ─────

const STATIC_PREFIX: string = systemMdText;

// ── Public API ────────────────────────────────────────────────────────

export async function buildSystemPrompt(): Promise<string> {
  const today = new Date().toISOString().split("T")[0];
  const [memory, accounts, payees, tags] = await Promise.all([getMemory(), listAccounts(), listPayees(), listTags()]);
  return getSystemPrompt({ today, memory, accounts, payees, tags, tools: [] });
}

export function getSystemPrompt(ctx: SystemPromptContext): string {
  const parts: string[] = [STATIC_PREFIX];

  // ── Tools section (after static prefix, before dynamic context) ────
  if (ctx.tools.length > 0) {
    const snippetLines = ctx.tools.map((t) => `- ${t.name}: ${t.snippet}`);
    let toolsSection = `\n<tools>\nAvailable tools:\n${snippetLines.join("\n")}`;

    const allGuidelines = ctx.tools.flatMap((t) => t.guidelines ?? []);
    if (allGuidelines.length > 0) {
      toolsSection += `\n\nGuidelines:\n${allGuidelines.map((g) => `- ${g}`).join("\n")}`;
    }

    toolsSection += "\n</tools>";
    parts.push(toolsSection);
  }

  // ── Dynamic context ────────────────────────────────────────────────
  parts.push("\n<context>");

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

  parts.push("\n</context>");

  return parts.join("");
}
