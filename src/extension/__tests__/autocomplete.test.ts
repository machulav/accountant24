import { describe, expect, test } from "bun:test";
import type { AutocompleteItem, SlashCommand } from "@mariozechner/pi-tui";
import { AccountantAutocompleteProvider } from "../autocomplete.js";

function makeCommand(
  name: string,
  description?: string,
  getArgumentCompletions?: (text: string) => AutocompleteItem[],
): SlashCommand {
  return { name, description, getArgumentCompletions } as SlashCommand;
}

describe("AccountantAutocompleteProvider", () => {
  describe("constructor and setters", () => {
    test("should accept commands in constructor", async () => {
      const cmds = [makeCommand("help", "Show help")];
      const provider = new AccountantAutocompleteProvider(cmds);
      const result = await provider.getSuggestions(["/"], 0, 1);
      expect(result).not.toBeNull();
      expect(result?.items).toHaveLength(1);
      expect(result?.items[0].value).toBe("help");
    });

    test("should update commands via setCommands", async () => {
      const provider = new AccountantAutocompleteProvider([makeCommand("old")]);
      provider.setCommands([makeCommand("new", "New command")]);
      const result = await provider.getSuggestions(["/"], 0, 1);
      expect(result).not.toBeNull();
      expect(result?.items).toHaveLength(1);
      expect(result?.items[0].value).toBe("new");
    });

    test("should update data via setData", async () => {
      const provider = new AccountantAutocompleteProvider([]);
      provider.setData(["expenses:food"], ["Grocery Store"]);
      const result = await provider.getSuggestions(["@"], 0, 1);
      expect(result).not.toBeNull();
      expect(result?.items).toHaveLength(2);
      const values = result?.items.map((i) => i.value);
      expect(values).toContain("expenses:food");
      expect(values).toContain("Grocery Store");
    });
  });

  describe("getSuggestions() - @ trigger", () => {
    function makeProvider(accounts: string[] = [], payees: string[] = []) {
      const provider = new AccountantAutocompleteProvider([]);
      provider.setData(accounts, payees);
      return provider;
    }

    test("should return all accounts and payees when @ typed alone", async () => {
      const provider = makeProvider(["expenses:food", "assets:bank"], ["Amazon", "Walmart"]);
      const result = await provider.getSuggestions(["@"], 0, 1);
      expect(result).not.toBeNull();
      expect(result?.items).toHaveLength(4);
      expect(result?.items[0]).toEqual({ value: "expenses:food", label: "expenses:food", description: "account" });
      expect(result?.items[1]).toEqual({ value: "assets:bank", label: "assets:bank", description: "account" });
      expect(result?.items[2]).toEqual({ value: "Amazon", label: "Amazon", description: "payee" });
      expect(result?.items[3]).toEqual({ value: "Walmart", label: "Walmart", description: "payee" });
      expect(result?.prefix).toBe("@");
    });

    test("should filter by query after @", async () => {
      const provider = makeProvider(["expenses:food", "assets:bank"], ["Amazon"]);
      const result = await provider.getSuggestions(["@exp"], 0, 4);
      expect(result).not.toBeNull();
      const values = result?.items.map((i) => i.value);
      expect(values).toContain("expenses:food");
      expect(values).not.toContain("Amazon");
      expect(result?.prefix).toBe("@exp");
    });

    test("should return null when no matches", async () => {
      const provider = makeProvider(["expenses:food"], ["Amazon"]);
      const result = await provider.getSuggestions(["@zzzznothing"], 0, 12);
      expect(result).toBeNull();
    });

    test("should limit to 20 results", async () => {
      const accounts = Array.from({ length: 25 }, (_, i) => `account${i}`);
      const provider = makeProvider(accounts, []);
      const result = await provider.getSuggestions(["@"], 0, 1);
      expect(result).not.toBeNull();
      expect(result?.items).toHaveLength(20);
    });

    test("should detect @ after space delimiter", async () => {
      const provider = makeProvider(["expenses:food"], []);
      const result = await provider.getSuggestions(["hello @exp"], 0, 10);
      expect(result).not.toBeNull();
      expect(result?.prefix).toBe("@exp");
    });

    test("should detect @ after tab delimiter", async () => {
      const provider = makeProvider(["expenses:food"], []);
      const result = await provider.getSuggestions(["hello\t@exp"], 0, 10);
      expect(result).not.toBeNull();
      expect(result?.prefix).toBe("@exp");
    });

    test("should detect @ after equals delimiter", async () => {
      const provider = makeProvider(["expenses:food"], []);
      const result = await provider.getSuggestions(["key=@exp"], 0, 8);
      expect(result).not.toBeNull();
      expect(result?.prefix).toBe("@exp");
    });

    test("should detect @ after double-quote delimiter", async () => {
      const provider = makeProvider(["expenses:food"], []);
      const result = await provider.getSuggestions(['value="@exp'], 0, 11);
      expect(result).not.toBeNull();
      expect(result?.prefix).toBe("@exp");
    });

    test("should detect @ after single-quote delimiter", async () => {
      const provider = makeProvider(["expenses:food"], []);
      const result = await provider.getSuggestions(["value='@exp"], 0, 11);
      expect(result).not.toBeNull();
      expect(result?.prefix).toBe("@exp");
    });

    test("should return null for empty line", async () => {
      const provider = makeProvider(["expenses:food"], []);
      const result = await provider.getSuggestions([""], 0, 0);
      expect(result).toBeNull();
    });

    test("should return null when no @ in token", async () => {
      const provider = makeProvider(["expenses:food"], []);
      const result = await provider.getSuggestions(["hello"], 0, 5);
      expect(result).toBeNull();
    });

    test("should return prefix including @", async () => {
      const provider = makeProvider(["expenses:food"], []);
      const result = await provider.getSuggestions(["text @expenses"], 0, 14);
      expect(result).not.toBeNull();
      expect(result?.prefix).toBe("@expenses");
    });

    test("should label accounts with 'account' description and payees with 'payee'", async () => {
      const provider = makeProvider(["assets:checking"], ["Bob"]);
      const result = await provider.getSuggestions(["@"], 0, 1);
      expect(result).not.toBeNull();
      const accountItem = result?.items.find((i) => i.value === "assets:checking");
      const payeeItem = result?.items.find((i) => i.value === "Bob");
      expect(accountItem?.description).toBe("account");
      expect(payeeItem?.description).toBe("payee");
    });

    test("should handle cursor on a line other than the first", async () => {
      const provider = makeProvider(["expenses:food"], []);
      const result = await provider.getSuggestions(["first line", "@exp"], 1, 4);
      expect(result).not.toBeNull();
      expect(result?.prefix).toBe("@exp");
    });

    test("should handle cursorLine pointing to undefined line", async () => {
      const provider = makeProvider(["expenses:food"], []);
      const result = await provider.getSuggestions([], 5, 0);
      expect(result).toBeNull();
    });
  });

  describe("getSuggestions() - / trigger", () => {
    test("should return all commands when / typed alone", async () => {
      const cmds = [makeCommand("help", "Show help"), makeCommand("add", "Add transaction")];
      const provider = new AccountantAutocompleteProvider(cmds);
      const result = await provider.getSuggestions(["/"], 0, 1);
      expect(result).not.toBeNull();
      expect(result?.items).toHaveLength(2);
      expect(result?.prefix).toBe("/");
    });

    test("should filter commands by prefix text", async () => {
      const cmds = [makeCommand("help", "Show help"), makeCommand("add", "Add transaction")];
      const provider = new AccountantAutocompleteProvider(cmds);
      const result = await provider.getSuggestions(["/he"], 0, 3);
      expect(result).not.toBeNull();
      const values = result?.items.map((i) => i.value);
      expect(values).toContain("help");
      expect(values).not.toContain("add");
      expect(result?.prefix).toBe("/he");
    });

    test("should return null when no commands match", async () => {
      const cmds = [makeCommand("help")];
      const provider = new AccountantAutocompleteProvider(cmds);
      const result = await provider.getSuggestions(["/zzzzz"], 0, 6);
      expect(result).toBeNull();
    });

    test("should include description when command has one", async () => {
      const cmds = [makeCommand("help", "Show help text")];
      const provider = new AccountantAutocompleteProvider(cmds);
      const result = await provider.getSuggestions(["/"], 0, 1);
      expect(result).not.toBeNull();
      expect(result?.items[0].description).toBe("Show help text");
    });

    test("should omit description when command has none", async () => {
      const cmds = [makeCommand("help")];
      const provider = new AccountantAutocompleteProvider(cmds);
      const result = await provider.getSuggestions(["/"], 0, 1);
      expect(result).not.toBeNull();
      expect(result?.items[0]).not.toHaveProperty("description");
    });

    test("should return argument completions after command name and space", async () => {
      const argItems: AutocompleteItem[] = [{ value: "verbose", label: "verbose", description: "Verbose mode" }];
      const cmds = [makeCommand("config", "Config", () => argItems)];
      const provider = new AccountantAutocompleteProvider(cmds);
      const result = await provider.getSuggestions(["/config ver"], 0, 11);
      expect(result).not.toBeNull();
      expect(result?.items).toEqual(argItems);
      expect(result?.prefix).toBe("ver");
    });

    test("should pass argument text to getArgumentCompletions", async () => {
      let receivedText = "";
      const cmds = [
        makeCommand("config", "Config", (text) => {
          receivedText = text;
          return [{ value: "x", label: "x" }];
        }),
      ];
      const provider = new AccountantAutocompleteProvider(cmds);
      await provider.getSuggestions(["/config some-arg"], 0, 16);
      expect(receivedText).toBe("some-arg");
    });

    test("should return null when command not found", async () => {
      const cmds = [makeCommand("help")];
      const provider = new AccountantAutocompleteProvider(cmds);
      const result = await provider.getSuggestions(["/unknown arg"], 0, 12);
      expect(result).toBeNull();
    });

    test("should return null when command has no getArgumentCompletions", async () => {
      const cmds = [makeCommand("help", "Show help")];
      const provider = new AccountantAutocompleteProvider(cmds);
      const result = await provider.getSuggestions(["/help arg"], 0, 9);
      expect(result).toBeNull();
    });

    test("should return null when getArgumentCompletions returns empty array", async () => {
      const cmds = [makeCommand("config", "Config", () => [])];
      const provider = new AccountantAutocompleteProvider(cmds);
      const result = await provider.getSuggestions(["/config arg"], 0, 11);
      expect(result).toBeNull();
    });

    test("should return null when getArgumentCompletions returns null/undefined", async () => {
      const cmds = [makeCommand("config", "Config", () => null as any)];
      const provider = new AccountantAutocompleteProvider(cmds);
      const result = await provider.getSuggestions(["/config arg"], 0, 11);
      expect(result).toBeNull();
    });

    test("should use empty string as argument text when space is right at cursor", async () => {
      let receivedText = "";
      const cmds = [
        makeCommand("config", "Config", (text) => {
          receivedText = text;
          return [{ value: "opt", label: "opt" }];
        }),
      ];
      const provider = new AccountantAutocompleteProvider(cmds);
      await provider.getSuggestions(["/config "], 0, 8);
      expect(receivedText).toBe("");
    });
  });

  describe("getSuggestions() - no trigger", () => {
    test("should return null for plain text", async () => {
      const provider = new AccountantAutocompleteProvider([makeCommand("help")]);
      provider.setData(["expenses:food"], ["Amazon"]);
      const result = await provider.getSuggestions(["just some text"], 0, 14);
      expect(result).toBeNull();
    });

    test("should return null for text not starting with /", async () => {
      const provider = new AccountantAutocompleteProvider([makeCommand("help")]);
      const result = await provider.getSuggestions(["hello /help"], 0, 11);
      expect(result).toBeNull();
    });
  });

  describe("applyCompletion()", () => {
    test("should insert slash command with leading / and trailing space", () => {
      const provider = new AccountantAutocompleteProvider([]);
      const item: AutocompleteItem = { value: "help", label: "help" };
      const result = provider.applyCompletion(["/he"], 0, 3, item, "/he");
      expect(result.lines[0]).toBe("/help ");
    });

    test("should place cursor after slash command + space", () => {
      const provider = new AccountantAutocompleteProvider([]);
      const item: AutocompleteItem = { value: "help", label: "help" };
      const result = provider.applyCompletion(["/he"], 0, 3, item, "/he");
      expect(result.cursorCol).toBe(6);
      expect(result.cursorLine).toBe(0);
    });

    test("should insert argument completion without extra space", () => {
      const provider = new AccountantAutocompleteProvider([]);
      const item: AutocompleteItem = { value: "verbose", label: "verbose" };
      const result = provider.applyCompletion(["/config ver"], 0, 11, item, "ver");
      expect(result.lines[0]).toBe("/config verbose");
    });

    test("should place cursor after argument", () => {
      const provider = new AccountantAutocompleteProvider([]);
      const item: AutocompleteItem = { value: "verbose", label: "verbose" };
      const result = provider.applyCompletion(["/config ver"], 0, 11, item, "ver");
      expect(result.cursorCol).toBe(15);
    });

    test("should insert @ mention with trailing space", () => {
      const provider = new AccountantAutocompleteProvider([]);
      const item: AutocompleteItem = { value: "expenses:food", label: "expenses:food" };
      const result = provider.applyCompletion(["@exp"], 0, 4, item, "@exp");
      expect(result.lines[0]).toBe("expenses:food ");
    });

    test("should place cursor after @ mention + space", () => {
      const provider = new AccountantAutocompleteProvider([]);
      const item: AutocompleteItem = { value: "expenses:food", label: "expenses:food" };
      const result = provider.applyCompletion(["@exp"], 0, 4, item, "@exp");
      expect(result.cursorCol).toBe(14);
    });

    test("should preserve text after cursor", () => {
      const provider = new AccountantAutocompleteProvider([]);
      const item: AutocompleteItem = { value: "expenses:food", label: "expenses:food" };
      const result = provider.applyCompletion(["buy @exp today"], 0, 8, item, "@exp");
      expect(result.lines[0]).toBe("buy expenses:food  today");
      expect(result.cursorCol).toBe(18);
    });

    test("should preserve other lines in the array", () => {
      const provider = new AccountantAutocompleteProvider([]);
      const item: AutocompleteItem = { value: "help", label: "help" };
      const lines = ["first line", "/he", "third line"];
      const result = provider.applyCompletion(lines, 1, 3, item, "/he");
      expect(result.lines[0]).toBe("first line");
      expect(result.lines[1]).toBe("/help ");
      expect(result.lines[2]).toBe("third line");
    });

    test("should not mutate original lines array", () => {
      const provider = new AccountantAutocompleteProvider([]);
      const item: AutocompleteItem = { value: "help", label: "help" };
      const original = ["/he"];
      provider.applyCompletion(original, 0, 3, item, "/he");
      expect(original[0]).toBe("/he");
    });

    test("should handle slash command completion with leading whitespace", () => {
      const provider = new AccountantAutocompleteProvider([]);
      const item: AutocompleteItem = { value: "help", label: "help" };
      const result = provider.applyCompletion(["  /he"], 0, 5, item, "/he");
      expect(result.lines[0]).toBe("  /help ");
      expect(result.cursorCol).toBe(8);
    });

    test("should handle @ mention in the middle of text", () => {
      const provider = new AccountantAutocompleteProvider([]);
      const item: AutocompleteItem = { value: "Amazon", label: "Amazon" };
      const result = provider.applyCompletion(["paid @Am for stuff"], 0, 8, item, "@Am");
      expect(result.lines[0]).toBe("paid Amazon  for stuff");
      expect(result.cursorCol).toBe(12);
    });
  });
});
