import { describe, expect, test } from "bun:test";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
  SlashCommand,
} from "@earendil-works/pi-tui";
import { AccountantAutocompleteProvider } from "../autocomplete";

function makeCommand(
  name: string,
  description?: string,
  getArgumentCompletions?: (text: string) => AutocompleteItem[],
): SlashCommand {
  return { name, description, getArgumentCompletions } as SlashCommand;
}

/** Records calls and returns a canned result, standing in for the built-in (file-path) provider. */
class MockDelegate implements AutocompleteProvider {
  triggerCharacters = ["#"];
  getSuggestionsCalls: Array<{ lines: string[]; cursorLine: number; cursorCol: number }> = [];
  applyCompletionCalls: Array<{ item: AutocompleteItem; prefix: string }> = [];
  suggestions: AutocompleteSuggestions | null = {
    items: [{ value: "src/file.ts", label: "src/file.ts" }],
    prefix: "src/",
  };

  async getSuggestions(lines: string[], cursorLine: number, cursorCol: number) {
    this.getSuggestionsCalls.push({ lines, cursorLine, cursorCol });
    return this.suggestions;
  }

  applyCompletion(_lines: string[], cursorLine: number, cursorCol: number, item: AutocompleteItem, prefix: string) {
    this.applyCompletionCalls.push({ item, prefix });
    return { lines: ["delegated"], cursorLine, cursorCol };
  }

  shouldTriggerFileCompletion() {
    return true;
  }
}

describe("AccountantAutocompleteProvider", () => {
  describe("setters", () => {
    test("should expose accounts, payees, and tags under @ trigger", async () => {
      const provider = new AccountantAutocompleteProvider();
      provider.setData(["expenses:food"], ["Grocery Store"], ["groceries"]);
      const result = await provider.getSuggestions(["@"], 0, 1);
      expect(result).not.toBeNull();
      expect(result?.items).toHaveLength(3);
      const values = result?.items.map((i) => i.value);
      expect(values).toContain("expenses:food");
      expect(values).toContain("Grocery Store");
      expect(values).toContain("groceries");
    });

    test("should expose commands via setCommands under / trigger", async () => {
      const provider = new AccountantAutocompleteProvider();
      provider.setCommands([makeCommand("new", "New command")]);
      const result = await provider.getSuggestions(["/"], 0, 1);
      expect(result).not.toBeNull();
      expect(result?.items).toHaveLength(1);
      expect(result?.items[0].value).toBe("new");
    });
  });

  describe("getSuggestions() - @ trigger", () => {
    function makeProvider(accounts: string[] = [], payees: string[] = [], tags: string[] = []) {
      const provider = new AccountantAutocompleteProvider();
      provider.setData(accounts, payees, tags);
      return provider;
    }

    test("should return all accounts, payees, and tags when @ typed alone", async () => {
      const provider = makeProvider(["expenses:food", "assets:bank"], ["Amazon", "Walmart"], ["groceries"]);
      const result = await provider.getSuggestions(["@"], 0, 1);
      expect(result).not.toBeNull();
      expect(result?.items).toHaveLength(5);
      expect(result?.items[0]).toEqual({ value: "expenses:food", label: "expenses:food", description: "account" });
      expect(result?.items[2]).toEqual({ value: "Amazon", label: "Amazon", description: "payee" });
      expect(result?.items[4]).toEqual({ value: "groceries", label: "groceries", description: "tag" });
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

    test("should detect @ after space delimiter", async () => {
      const provider = makeProvider(["expenses:food"], []);
      const result = await provider.getSuggestions(["hello @exp"], 0, 10);
      expect(result).not.toBeNull();
      expect(result?.prefix).toBe("@exp");
    });

    test("should detect @ after equals delimiter", async () => {
      const provider = makeProvider(["expenses:food"], []);
      const result = await provider.getSuggestions(["key=@exp"], 0, 8);
      expect(result).not.toBeNull();
      expect(result?.prefix).toBe("@exp");
    });

    test("should label accounts, payees, and tags", async () => {
      const provider = makeProvider(["assets:checking"], ["Bob"], ["groceries"]);
      const result = await provider.getSuggestions(["@"], 0, 1);
      expect(result).not.toBeNull();
      expect(result?.items.find((i) => i.value === "assets:checking")?.description).toBe("account");
      expect(result?.items.find((i) => i.value === "Bob")?.description).toBe("payee");
      expect(result?.items.find((i) => i.value === "groceries")?.description).toBe("tag");
    });
  });

  describe("getSuggestions() - / trigger (curated list)", () => {
    test("should return all commands when / typed alone", async () => {
      const provider = new AccountantAutocompleteProvider();
      provider.setCommands([makeCommand("new", "New session"), makeCommand("quit", "Quit")]);
      const result = await provider.getSuggestions(["/"], 0, 1);
      expect(result).not.toBeNull();
      expect(result?.items).toHaveLength(2);
      expect(result?.prefix).toBe("/");
    });

    test("should filter commands by prefix text", async () => {
      const provider = new AccountantAutocompleteProvider();
      provider.setCommands([makeCommand("model", "Select model"), makeCommand("quit", "Quit")]);
      const result = await provider.getSuggestions(["/mo"], 0, 3);
      expect(result).not.toBeNull();
      const values = result?.items.map((i) => i.value);
      expect(values).toContain("model");
      expect(values).not.toContain("quit");
    });

    test("should NOT delegate / input (curated list only)", async () => {
      const delegate = new MockDelegate();
      const provider = new AccountantAutocompleteProvider();
      provider.setDelegate(delegate);
      provider.setCommands([makeCommand("new")]);
      await provider.getSuggestions(["/zzzz"], 0, 5);
      expect(delegate.getSuggestionsCalls).toHaveLength(0);
    });

    test("should return null when no commands match", async () => {
      const provider = new AccountantAutocompleteProvider();
      provider.setCommands([makeCommand("new")]);
      const result = await provider.getSuggestions(["/zzzzz"], 0, 6);
      expect(result).toBeNull();
    });
  });

  describe("getSuggestions() - file-path delegation", () => {
    test("should delegate non-@/non-/ input to the wrapped provider", async () => {
      const delegate = new MockDelegate();
      const provider = new AccountantAutocompleteProvider();
      provider.setDelegate(delegate);
      const result = await provider.getSuggestions(["open src/"], 0, 9);
      expect(delegate.getSuggestionsCalls).toHaveLength(1);
      expect(result).toEqual(delegate.suggestions);
    });

    test("should NOT delegate @ input (handled locally)", async () => {
      const delegate = new MockDelegate();
      const provider = new AccountantAutocompleteProvider();
      provider.setDelegate(delegate);
      provider.setData(["expenses:food"], [], []);
      await provider.getSuggestions(["@exp"], 0, 4);
      expect(delegate.getSuggestionsCalls).toHaveLength(0);
    });

    test("should return null when no @/​/ trigger and no delegate", async () => {
      const provider = new AccountantAutocompleteProvider();
      const result = await provider.getSuggestions(["just some text"], 0, 14);
      expect(result).toBeNull();
    });

    test("should expose the delegate's trigger characters", () => {
      const provider = new AccountantAutocompleteProvider();
      expect(provider.triggerCharacters).toBeUndefined();
      provider.setDelegate(new MockDelegate());
      expect(provider.triggerCharacters).toEqual(["#"]);
    });

    test("should delegate shouldTriggerFileCompletion", () => {
      const provider = new AccountantAutocompleteProvider();
      expect(provider.shouldTriggerFileCompletion([""], 0, 0)).toBe(false);
      provider.setDelegate(new MockDelegate());
      expect(provider.shouldTriggerFileCompletion([""], 0, 0)).toBe(true);
    });
  });

  describe("applyCompletion() - @ mentions", () => {
    test("should insert @ mention with trailing space", () => {
      const provider = new AccountantAutocompleteProvider();
      const item: AutocompleteItem = { value: "expenses:food", label: "expenses:food" };
      const result = provider.applyCompletion(["@exp"], 0, 4, item, "@exp");
      expect(result.lines[0]).toBe("expenses:food ");
      expect(result.cursorCol).toBe(14);
    });

    test("should handle @ mention in the middle of text", () => {
      const provider = new AccountantAutocompleteProvider();
      const item: AutocompleteItem = { value: "Amazon", label: "Amazon" };
      const result = provider.applyCompletion(["paid @Am for stuff"], 0, 8, item, "@Am");
      expect(result.lines[0]).toBe("paid Amazon  for stuff");
      expect(result.cursorCol).toBe(12);
    });

    test("should not mutate original lines array", () => {
      const provider = new AccountantAutocompleteProvider();
      const item: AutocompleteItem = { value: "Amazon", label: "Amazon" };
      const original = ["@Am"];
      provider.applyCompletion(original, 0, 3, item, "@Am");
      expect(original[0]).toBe("@Am");
    });
  });

  describe("applyCompletion() - slash commands", () => {
    test("should insert slash command with leading / and trailing space", () => {
      const provider = new AccountantAutocompleteProvider();
      const item: AutocompleteItem = { value: "model", label: "model" };
      const result = provider.applyCompletion(["/mo"], 0, 3, item, "/mo");
      expect(result.lines[0]).toBe("/model ");
      expect(result.cursorCol).toBe(7);
    });
  });

  describe("applyCompletion() - file-path delegation", () => {
    test("should delegate non-@/non-/ completions to the wrapped provider", () => {
      const delegate = new MockDelegate();
      const provider = new AccountantAutocompleteProvider();
      provider.setDelegate(delegate);
      const item: AutocompleteItem = { value: "src/file.ts", label: "src/file.ts" };
      const result = provider.applyCompletion(["open src/"], 0, 9, item, "src/");
      expect(delegate.applyCompletionCalls).toHaveLength(1);
      expect(delegate.applyCompletionCalls[0]).toEqual({ item, prefix: "src/" });
      expect(result.lines[0]).toBe("delegated");
    });

    test("should replace the prefix with the raw value when no delegate is set", () => {
      const provider = new AccountantAutocompleteProvider();
      const item: AutocompleteItem = { value: "src/file.ts", label: "src/file.ts" };
      const result = provider.applyCompletion(["open src/"], 0, 9, item, "src/");
      expect(result.lines[0]).toBe("open src/file.ts");
    });
  });
});
