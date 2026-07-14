// Pure builders for the sections the extension appends to pi's assembled base
// prompt. At runtime pi renders our system.md (via --system-prompt) plus its
// native <available_skills> block and date/cwd lines; the app-specific tools and
// context sections below are appended per turn by the before_agent_start hook.

export interface ToolInfo {
  name: string;
  snippet: string;
}

export interface ContextSectionInput {
  today: string;
  memory: string;
  accounts: string[];
  payees: string[];
  tags: string[];
}

// pi bakes `Current date: YYYY-MM-DD` into the base prompt at session setup and
// caches it. A desktop session can span days, and a stale date would mis-date
// transactions — so the hook re-stamps the line each turn. Anchored per line;
// fails soft (base returned unchanged) if pi ever changes the format.
const BAKED_DATE_RE = /^Current date: \d{4}-\d{2}-\d{2}$/m;

export function patchBakedDate(base: string, today: string): string {
  return base.replace(BAKED_DATE_RE, `Current date: ${today}`);
}

export function buildToolsSection(tools: ToolInfo[], guidelines: string[]): string {
  if (tools.length === 0) return "";

  const snippetLines = tools.map((t) => `- ${t.name}: ${t.snippet}`);
  let section = `\n\n<tools>\nAvailable tools:\n${snippetLines.join("\n")}`;

  if (guidelines.length > 0) {
    section += `\n\nGuidelines:\n${guidelines.map((g) => `- ${g}`).join("\n")}`;
  }

  section += "\n</tools>";
  return section;
}

export function buildContextSection(input: ContextSectionInput): string {
  const parts: string[] = ["\n\n<context>"];

  parts.push(`\n\n<date>\nToday's date: ${input.today}\n</date>`);

  if (input.memory) {
    parts.push(`\n\n<memory>\n${input.memory}\n</memory>`);
  }

  parts.push(
    input.accounts.length > 0
      ? `\n\n<accounts>\nAll known accounts:\n${input.accounts.join("\n")}\n</accounts>`
      : `\n\n<accounts>\nNo accounts found.\n</accounts>`,
  );

  parts.push(
    input.payees.length > 0
      ? `\n\n<payees>\nAll known payees:\n${input.payees.join("\n")}\n</payees>`
      : `\n\n<payees>\nNo payees found.\n</payees>`,
  );

  parts.push(
    input.tags.length > 0
      ? `\n\n<tags>\nAll known tags:\n${input.tags.join("\n")}\n</tags>`
      : `\n\n<tags>\nNo tags found.\n</tags>`,
  );

  parts.push("\n\n</context>");

  return parts.join("");
}
