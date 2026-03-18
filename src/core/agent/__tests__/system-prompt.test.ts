import { expect, test } from "bun:test";
import { getSystemPrompt, type SystemPromptContext } from "../system-prompt.js";

const empty: SystemPromptContext = {
  today: "2026-03-19",
  facts: [],
  accounts: [],
  payees: [],
};

const populated: SystemPromptContext = {
  today: "2026-03-19",
  facts: ["Rent is $2100", "Landlord is John"],
  accounts: ["Assets:Checking", "Expenses:Food:Groceries", "Expenses:Rent"],
  payees: ["Whole Foods", "Starbucks", "John (Landlord)"],
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

test("empty context omits accounts section", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).not.toContain("<accounts>");
});

test("empty context omits known-payees section", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).not.toContain("<known-payees>");
});

// --- populated context ---

test("populated context includes memory with facts", () => {
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

test("populated context includes known payees", () => {
  const prompt = getSystemPrompt(populated);
  expect(prompt).toContain("<known-payees>");
  expect(prompt).toContain("Whole Foods");
  expect(prompt).toContain("Starbucks");
  expect(prompt).toContain("</known-payees>");
});

// --- static sections ---

test("includes identity section", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).toContain("<identity>");
  expect(prompt).toContain("BeanClaw");
  expect(prompt).toContain("</identity>");
});

test("includes workspace section", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).toContain("<workspace>");
  expect(prompt).toContain("</workspace>");
});

test("includes tool-strategy section", () => {
  const prompt = getSystemPrompt(empty);
  expect(prompt).toContain("<tool-strategy>");
  expect(prompt).toContain("</tool-strategy>");
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

// --- date injection ---

test("injects the provided date", () => {
  const ctx: SystemPromptContext = { ...empty, today: "2025-12-31" };
  const prompt = getSystemPrompt(ctx);
  expect(prompt).toContain("2025-12-31");
  expect(prompt).not.toContain("2026-03-19");
});

// --- ordering: static prefix before dynamic tail ---

test("static content comes before dynamic content", () => {
  const prompt = getSystemPrompt(populated);
  const identityPos = prompt.indexOf("<identity>");
  const sessionPos = prompt.indexOf("<session>");
  const memoryPos = prompt.indexOf("<memory>");
  expect(identityPos).toBeLessThan(sessionPos);
  expect(sessionPos).toBeLessThan(memoryPos);
});
