import { describe, expect, mock, test } from "bun:test";

let mockMemory = "";
let mockAccounts: string[] = [];
let mockPayees: string[] = [];
let mockTags: string[] = [];

mock.module("../../ledger/index", () => ({
  listAccounts: async () => mockAccounts,
  listPayees: async () => mockPayees,
  listTags: async () => mockTags,
}));
mock.module("../../memory/index", () => ({
  getMemory: async () => mockMemory,
}));

const mod = await import("../system-prompt.js");
const getSystemPrompt = mod.getSystemPrompt;
const buildSystemPrompt = mod.buildSystemPrompt;
type SystemPromptContext = typeof mod extends { getSystemPrompt: (ctx: infer C) => any } ? C : never;

const sampleTools = [
  { name: "read", snippet: "Read file contents", guidelines: ["Use read to examine files instead of cat or sed."] },
  { name: "bash", snippet: "Execute bash commands" },
  { name: "query", snippet: "Run hledger reports" },
  {
    name: "commit_and_push",
    snippet: "Commit all changes and push to remote",
    guidelines: ["Call commit_and_push after completing a batch of related changes."],
  },
];

const empty: SystemPromptContext = {
  today: "2026-03-19",
  memory: "",
  accounts: [],
  payees: [],
  tags: [],
  tools: sampleTools,
};

const populated: SystemPromptContext = {
  today: "2026-03-19",
  memory: "- Rent is $2100\n- Landlord is John",
  accounts: ["Assets:Checking", "Expenses:Food:Groceries", "Expenses:Rent"],
  payees: ["Whole Foods", "Starbucks", "John (Landlord)"],
  tags: ["groceries", "weekly", "source"],
  tools: sampleTools,
};

// --- empty context ---

test("empty context includes session date", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).toContain("<session>");
  expect(prompt).toContain("2026-03-19");
  expect(prompt).toContain("</session>");
});

test("empty context omits memory section", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).not.toContain("<memory>");
});

test("empty context includes accounts section with fallback message", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).toContain("<accounts>");
  expect(prompt).toContain("No accounts found.");
  expect(prompt).toContain("</accounts>");
});

test("empty context includes payees section with fallback message", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).toContain("<payees>");
  expect(prompt).toContain("No payees found.");
  expect(prompt).toContain("</payees>");
});

test("empty context includes tags section with fallback message", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).toContain("<tags>");
  expect(prompt).toContain("No tags found.");
  expect(prompt).toContain("</tags>");
});

// --- populated context ---

test("populated context includes memory with markdown content", () => {
  const prompt = getSystemPrompt(populated);
  expect(prompt).toContain("<memory>");
  expect(prompt).toContain("- Rent is $2100");
  expect(prompt).toContain("- Landlord is John");
  expect(prompt).toContain("</memory>");
});

test("populated context includes accounts", () => {
  const prompt = getSystemPrompt(populated);
  expect(prompt).toContain("<accounts>");
  expect(prompt).toContain("Assets:Checking");
  expect(prompt).toContain("Expenses:Food:Groceries");
  expect(prompt).toContain("</accounts>");
});

test("populated context includes payees", () => {
  const prompt = getSystemPrompt(populated);
  expect(prompt).toContain("<payees>");
  expect(prompt).toContain("Whole Foods");
  expect(prompt).toContain("Starbucks");
  expect(prompt).toContain("</payees>");
});

test("populated context includes tags", () => {
  const prompt = getSystemPrompt(populated);
  expect(prompt).toContain("<tags>");
  expect(prompt).toContain("groceries");
  expect(prompt).toContain("weekly");
  expect(prompt).toContain("source");
  expect(prompt).toContain("</tags>");
});

// --- static sections ---

test("includes identity section", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).toContain("<identity>");
  expect(prompt).toContain("Accountant24");
  expect(prompt).toContain("</identity>");
});

test("includes workspace section", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).toContain("<workspace>");
  expect(prompt).toContain("</workspace>");
});

test("includes tool-strategy section with invariants structure", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).toContain("<tool-strategy>");
  expect(prompt).toContain("DATA QUALITY INVARIANTS:");
  expect(prompt).toContain("DECISION HEURISTICS:");
  expect(prompt).toContain("ANTI-PATTERNS");
  expect(prompt).toContain("</tool-strategy>");
});

test("tool-strategy does not contain migrated subsections", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).not.toContain("REMEMBERING:");
  expect(prompt).not.toContain("TEXT EXTRACTION:");
  expect(prompt).not.toContain("VERSION CONTROL:");
  expect(prompt).not.toContain("FINANCIAL QUESTIONS:");
});

test("does not contain prescriptive process language", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).not.toContain("This step is mandatory");
  expect(prompt).not.toContain("Step 1 —");
  expect(prompt).not.toContain("Step 2 —");
  expect(prompt).not.toContain("Step 5 —");
  expect(prompt).not.toContain("you MUST follow this exact sequence");
  expect(prompt).not.toContain("you MUST ask");
  expect(prompt).not.toContain("you MUST have");
  expect(prompt).not.toContain("gather it first");
  expect(prompt).not.toContain("ASSISTANT thinks:");
  expect(prompt).not.toContain("ASSISTANT uses:");
});

test("includes examples section", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).toContain("<examples>");
  expect(prompt).toContain("</examples>");
});

test("includes conventions section", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).toContain("<conventions>");
  expect(prompt).toContain("</conventions>");
});

test("includes response-style section", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).toContain("<response-style>");
  expect(prompt).toContain("</response-style>");
});

// --- tools section ---

test("includes tools section with snippets", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).toContain("<tools>");
  expect(prompt).toContain("- read: Read file contents");
  expect(prompt).toContain("- bash: Execute bash commands");
  expect(prompt).toContain("- query: Run hledger reports");
  expect(prompt).toContain("- commit_and_push: Commit all changes and push to remote");
  expect(prompt).toContain("</tools>");
});

test("includes tool guidelines in tools section", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).toContain("Guidelines:");
  expect(prompt).toContain("- Use read to examine files instead of cat or sed.");
  expect(prompt).toContain("- Call commit_and_push after completing a batch of related changes.");
});

test("omits tools section when tools array is empty", () => {
  const ctx: SystemPromptContext = { ...empty, tools: [] };
  const prompt = getSystemPrompt(ctx);
  expect(prompt).not.toContain("<tools>");
});

test("omits guidelines sub-section when no tools have guidelines", () => {
  const ctx: SystemPromptContext = {
    ...empty,
    tools: [{ name: "validate", snippet: "Check the ledger" }],
  };
  const prompt = getSystemPrompt(ctx);
  expect(prompt).toContain("<tools>");
  expect(prompt).not.toContain("Guidelines:");
});

// --- context wrapper ---

test("wraps dynamic sections in context tags", () => {
  const prompt = getSystemPrompt(populated);
  expect(prompt).toContain("<context>");
  expect(prompt).toContain("</context>");

  const contextStart = prompt.indexOf("<context>");
  const contextEnd = prompt.indexOf("</context>");
  const sessionPos = prompt.indexOf("<session>");
  const memoryPos = prompt.indexOf("<memory>");
  const accountsPos = prompt.indexOf("<accounts>");

  expect(sessionPos).toBeGreaterThan(contextStart);
  expect(memoryPos).toBeGreaterThan(contextStart);
  expect(accountsPos).toBeGreaterThan(contextStart);
  expect(accountsPos).toBeLessThan(contextEnd);
});

// --- date injection ---

test("injects the provided date", () => {
  const ctx: SystemPromptContext = { ...empty, today: "2025-12-31" };
  const prompt = getSystemPrompt(ctx);
  expect(prompt).toContain("2025-12-31");
  expect(prompt).not.toContain("2026-03-19");
});

// --- ordering: static prefix before tools before context ---

test("static content comes before tools section, tools before context", () => {
  const prompt = getSystemPrompt(populated);
  const identityPos = prompt.indexOf("<identity>");
  const toolsPos = prompt.indexOf("<tools>");
  const contextPos = prompt.indexOf("<context>");
  const sessionPos = prompt.indexOf("<session>");
  const memoryPos = prompt.indexOf("<memory>");
  expect(identityPos).toBeLessThan(toolsPos);
  expect(toolsPos).toBeLessThan(contextPos);
  expect(contextPos).toBeLessThan(sessionPos);
  expect(sessionPos).toBeLessThan(memoryPos);
});

// --- buildSystemPrompt() ---

describe("buildSystemPrompt()", () => {
  test("should return prompt containing today's date", async () => {
    mockMemory = "";
    mockAccounts = [];
    mockPayees = [];
    mockTags = [];
    const prompt = await buildSystemPrompt();
    const today = new Date().toISOString().split("T")[0];
    expect(prompt).toContain(today);
  });

  test("should include memory content", async () => {
    mockMemory = "Rent is $2100 monthly";
    mockAccounts = [];
    mockPayees = [];
    mockTags = [];
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("<memory>");
    expect(prompt).toContain("Rent is $2100 monthly");
  });

  test("should include accounts", async () => {
    mockMemory = "";
    mockAccounts = ["Assets:Checking", "Expenses:Food"];
    mockPayees = [];
    mockTags = [];
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("<accounts>");
    expect(prompt).toContain("Assets:Checking");
  });

  test("should include payees", async () => {
    mockMemory = "";
    mockAccounts = [];
    mockPayees = ["Whole Foods", "Amazon"];
    mockTags = [];
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("<payees>");
    expect(prompt).toContain("Whole Foods");
  });

  test("should include tags", async () => {
    mockMemory = "";
    mockAccounts = [];
    mockPayees = [];
    mockTags = ["groceries", "weekly"];
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("<tags>");
    expect(prompt).toContain("groceries");
  });

  test("should omit memory when empty but include fallback for accounts, payees, tags", async () => {
    mockMemory = "";
    mockAccounts = [];
    mockPayees = [];
    mockTags = [];
    const prompt = await buildSystemPrompt();
    expect(prompt).not.toContain("<memory>");
    expect(prompt).toContain("No accounts found.");
    expect(prompt).toContain("No payees found.");
    expect(prompt).toContain("No tags found.");
  });

  test("should not include tools section (no tool metadata available)", async () => {
    mockMemory = "";
    mockAccounts = [];
    mockPayees = [];
    mockTags = [];
    const prompt = await buildSystemPrompt();
    expect(prompt).not.toContain("<tools>");
  });

  test("should wrap dynamic sections in context tags", async () => {
    mockMemory = "";
    mockAccounts = [];
    mockPayees = [];
    mockTags = [];
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("<context>");
    expect(prompt).toContain("</context>");
  });
});
