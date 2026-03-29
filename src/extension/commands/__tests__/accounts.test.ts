import { describe, expect, mock, test } from "bun:test";
import { formatAccounts } from "../accounts";

let mockLoadAccounts: () => Promise<string[]>;
mock.module("../../data/index", () => ({
  listAccounts: async () => mockLoadAccounts(),
}));

const { accountsCommand } = await import("../accounts.js");

describe("accountsCommand()", () => {
  test("should register command named 'accounts' with correct description", () => {
    const pi = { registerCommand: mock(() => {}), sendMessage: mock(() => {}) } as any;
    accountsCommand(pi);
    expect(pi.registerCommand).toHaveBeenCalledTimes(1);
    const [name, opts] = pi.registerCommand.mock.calls[0];
    expect(name).toBe("accounts");
    expect(opts.description).toBe("List all accounts");
  });

  test("should send formatted accounts when accounts exist", async () => {
    mockLoadAccounts = async () => ["assets:checking", "expenses:food:groceries"];
    const pi = { registerCommand: mock(() => {}), sendMessage: mock(() => {}) } as any;
    accountsCommand(pi);
    const handler = pi.registerCommand.mock.calls[0][1].handler;
    await handler();
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
    const msg = pi.sendMessage.mock.calls[0][0];
    expect(msg.customType).toBe("info");
    expect(msg.content[0].text).toBe(formatAccounts(["assets:checking", "expenses:food:groceries"]));
    expect(msg.display).toBe(true);
  });

  test("should send 'No accounts found.' when no accounts", async () => {
    mockLoadAccounts = async () => [];
    const pi = { registerCommand: mock(() => {}), sendMessage: mock(() => {}) } as any;
    accountsCommand(pi);
    const handler = pi.registerCommand.mock.calls[0][1].handler;
    await handler();
    const msg = pi.sendMessage.mock.calls[0][0];
    expect(msg.content[0].text).toBe("No accounts found.");
  });
});

describe("formatAccounts()", () => {
  test("should return 'No accounts found.' for empty array", () => {
    expect(formatAccounts([])).toBe("No accounts found.");
  });

  test("should show header without count", () => {
    const result = formatAccounts(["assets:cash", "income:salary"]);
    expect(result).toStartWith("# Accounts");
    expect(result).not.toContain("# Accounts (");
  });

  test("should group accounts by type in canonical order", () => {
    const accounts = ["income:salary", "assets:cash", "expenses:food:groceries", "liabilities:credit-card"];
    const result = formatAccounts(accounts);
    const assetsIdx = result.indexOf("## Assets");
    const liabilitiesIdx = result.indexOf("## Liabilities");
    const incomeIdx = result.indexOf("## Income");
    const expensesIdx = result.indexOf("## Expenses");
    expect(assetsIdx).toBeLessThan(liabilitiesIdx);
    expect(liabilitiesIdx).toBeLessThan(incomeIdx);
    expect(incomeIdx).toBeLessThan(expensesIdx);
  });

  test("should skip empty type sections", () => {
    const result = formatAccounts(["assets:cash"]);
    expect(result).toContain("## Assets");
    expect(result).not.toContain("## Liabilities");
    expect(result).not.toContain("## Expenses");
  });

  test("should include type legend at the top as blockquote with aligned dashes", () => {
    const result = formatAccounts(["assets:cash", "expenses:food:groceries"]);
    expect(result).toContain("> Account types:");
    const legendIdx = result.indexOf("> Account types:");
    const firstSection = result.indexOf("## Assets");
    expect(legendIdx).toBeLessThan(firstSection);
    // Dashes should be vertically aligned
    const lines = result.split("\n");
    const assetsLine = lines.find((l) => l.includes("**Assets**")) ?? "";
    const expensesLine = lines.find((l) => l.includes("**Expenses**")) ?? "";
    expect(assetsLine.indexOf("—")).toBe(expensesLine.indexOf("—"));
  });

  test("should use full account names in bullet items", () => {
    const result = formatAccounts(["expenses:food:groceries"]);
    expect(result).toContain("- expenses:food:groceries");
  });

  test("should insert blank lines between expense subcategories", () => {
    const accounts = ["expenses:children:childcare", "expenses:food:groceries"];
    const result = formatAccounts(accounts);
    expect(result).toContain("- expenses:children:childcare\n\n- expenses:food:groceries");
  });

  test("should not insert blank line within same expense subcategory", () => {
    const accounts = ["expenses:food:dining-out", "expenses:food:groceries"];
    const result = formatAccounts(accounts);
    expect(result).toContain("- expenses:food:dining-out\n- expenses:food:groceries");
  });

  test("should handle expenses:uncategorized as its own group", () => {
    const accounts = ["expenses:food:groceries", "expenses:uncategorized"];
    const result = formatAccounts(accounts);
    expect(result).toContain("- expenses:food:groceries\n\n- expenses:uncategorized");
  });

  test("should put unknown type accounts under Other", () => {
    const result = formatAccounts(["custom:savings"]);
    expect(result).toContain("## Other");
    expect(result).toContain("- custom:savings");
  });

  test("should put accounts without colon under Other", () => {
    const result = formatAccounts(["cash"]);
    expect(result).toContain("## Other");
    expect(result).toContain("- cash");
  });

  test("should match type case-insensitively", () => {
    const result = formatAccounts(["Assets:Checking"]);
    expect(result).toContain("## Assets");
    expect(result).toContain("- Assets:Checking");
  });

  test("should include @ tip at the end", () => {
    const result = formatAccounts(["assets:cash"]);
    expect(result).toEndWith(
      "> **Tip:** Type `@` in the input field to quickly search and mention accounts, payees, and tags.",
    );
  });

  test("should not include tip for empty accounts", () => {
    expect(formatAccounts([])).not.toContain("Tip");
  });
});
