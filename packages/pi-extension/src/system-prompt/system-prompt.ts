import { listAccounts, listPayees, listTags } from "../ledger";
import { getMemory } from "../memory";
// Text import so esbuild inlines system.md into the bundle (scripts/bundle-extension.ts).
// @ts-expect-error — TS lib doesn't ship types for text import attributes yet
import systemMdText from "./system.md" with { type: "text" };

export interface SystemPromptContext {
  today: string;
  memory: string;
  accounts: string[];
  payees: string[];
  tags: string[];
  /** Active tools to advertise, as (name, one-line snippet) pairs. */
  tools: Array<{ name: string; snippet: string }>;
  /** Flat list of guideline bullets for the active tools. */
  guidelines: string[];
}

// ── Static prefix (loaded from system.md, cached by Claude API) ─────

const STATIC_PREFIX: string = systemMdText;

// ── Public API ────────────────────────────────────────────────────────

export async function buildSystemPrompt(): Promise<string> {
  const today = new Date().toISOString().split("T")[0];
  const [memory, accounts, payees, tags] = await Promise.all([getMemory(), listAccounts(), listPayees(), listTags()]);
  return getSystemPrompt({ today, memory, accounts, payees, tags, tools: [], guidelines: [] });
}

export function getSystemPrompt(ctx: SystemPromptContext): string {
  const parts: string[] = [STATIC_PREFIX];

  // ── Tools section (after static prefix, before dynamic context) ────
  if (ctx.tools.length > 0) {
    const snippetLines = ctx.tools.map((t) => `- ${t.name}: ${t.snippet}`);
    let toolsSection = `\n\n<tools>\nAvailable tools:\n${snippetLines.join("\n")}`;

    if (ctx.guidelines.length > 0) {
      toolsSection += `\n\nGuidelines:\n${ctx.guidelines.map((g) => `- ${g}`).join("\n")}`;
    }

    toolsSection += "\n</tools>";
    parts.push(toolsSection);
  }

  // ── Dynamic context ────────────────────────────────────────────────
  parts.push("\n\n<context>");

  parts.push(`\n\n<date>\nToday's date: ${ctx.today}\n</date>`);

  if (ctx.memory) {
    parts.push(`\n\n<memory>\n${ctx.memory}\n</memory>`);
  }

  parts.push(
    ctx.accounts.length > 0
      ? `\n\n<accounts>\nAll known accounts:\n${ctx.accounts.join("\n")}\n</accounts>`
      : `\n\n<accounts>\nNo accounts found.\n</accounts>`,
  );

  parts.push(
    ctx.payees.length > 0
      ? `\n\n<payees>\nAll known payees:\n${ctx.payees.join("\n")}\n</payees>`
      : `\n\n<payees>\nNo payees found.\n</payees>`,
  );

  parts.push(
    ctx.tags.length > 0
      ? `\n\n<tags>\nAll known tags:\n${ctx.tags.join("\n")}\n</tags>`
      : `\n\n<tags>\nNo tags found.\n</tags>`,
  );

  parts.push("\n\n</context>");

  return parts.join("");
}
