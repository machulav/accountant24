import type { AutocompleteItem, AutocompleteProvider, SlashCommand } from "@mariozechner/pi-tui";
import { fuzzyFilter } from "@mariozechner/pi-tui";

const PATH_DELIMITERS = new Set([" ", "\t", '"', "'", "="]);
const MAX_SUGGESTIONS = 20;

export class AccountantAutocompleteProvider implements AutocompleteProvider {
  private commands: SlashCommand[];
  private accounts: string[] = [];
  private payees: string[] = [];

  constructor(commands: SlashCommand[]) {
    this.commands = commands;
  }

  setCommands(commands: SlashCommand[]): void {
    this.commands = commands;
  }

  setData(accounts: string[], payees: string[]): void {
    this.accounts = accounts;
    this.payees = payees;
  }

  async getSuggestions(lines: string[], cursorLine: number, cursorCol: number) {
    const line = lines[cursorLine] || "";
    const before = line.slice(0, cursorCol);

    // @ trigger: payee/account mentions
    const atPrefix = this.extractAtPrefix(before);
    if (atPrefix) {
      const query = atPrefix.slice(1); // remove leading @
      const items: AutocompleteItem[] = [
        ...this.accounts.map((a) => ({ value: a, label: a, description: "account" })),
        ...this.payees.map((p) => ({ value: p, label: p, description: "payee" })),
      ];
      const filtered = query ? fuzzyFilter(items, query, (item) => item.label) : items;
      if (filtered.length === 0) return null;
      return { items: filtered.slice(0, MAX_SUGGESTIONS), prefix: atPrefix };
    }

    // / trigger: slash commands
    if (before.startsWith("/")) {
      const spaceIndex = before.indexOf(" ");
      if (spaceIndex === -1) {
        // Complete command names
        const prefix = before.slice(1);
        const commandItems = this.commands.map((cmd) => ({
          name: cmd.name,
          label: cmd.name,
          description: cmd.description,
        }));
        const filtered = fuzzyFilter(commandItems, prefix, (item) => item.name).map((item) => ({
          value: item.name,
          label: item.label,
          ...(item.description && { description: item.description }),
        }));
        if (filtered.length === 0) return null;
        return { items: filtered, prefix: before };
      }
      // Complete command arguments
      const commandName = before.slice(1, spaceIndex);
      const argumentText = before.slice(spaceIndex + 1);
      const command = this.commands.find((cmd) => cmd.name === commandName);
      if (!command?.getArgumentCompletions) return null;
      const argumentSuggestions = command.getArgumentCompletions(argumentText);
      if (!argumentSuggestions || argumentSuggestions.length === 0) return null;
      return { items: argumentSuggestions, prefix: argumentText };
    }

    return null;
  }

  applyCompletion(lines: string[], cursorLine: number, cursorCol: number, item: AutocompleteItem, prefix: string) {
    const line = lines[cursorLine] || "";
    const beforePrefix = line.slice(0, cursorCol - prefix.length);
    const after = line.slice(cursorCol);
    const newLines = [...lines];

    // Slash command completion
    if (prefix.startsWith("/") && beforePrefix.trim() === "" && !prefix.slice(1).includes("/")) {
      newLines[cursorLine] = `${beforePrefix}/${item.value} ${after}`;
      return { lines: newLines, cursorLine, cursorCol: beforePrefix.length + item.value.length + 2 };
    }

    // Slash command argument completion
    if (beforePrefix.includes("/") && beforePrefix.includes(" ")) {
      newLines[cursorLine] = `${beforePrefix}${item.value}${after}`;
      return { lines: newLines, cursorLine, cursorCol: beforePrefix.length + item.value.length };
    }

    // @ mention completion — insert value with trailing space
    newLines[cursorLine] = `${beforePrefix}${item.value} ${after}`;
    return { lines: newLines, cursorLine, cursorCol: beforePrefix.length + item.value.length + 1 };
  }

  private extractAtPrefix(text: string): string | null {
    let lastDelim = -1;
    for (let i = text.length - 1; i >= 0; i--) {
      if (PATH_DELIMITERS.has(text[i])) {
        lastDelim = i;
        break;
      }
    }
    const tokenStart = lastDelim === -1 ? 0 : lastDelim + 1;
    if (text[tokenStart] === "@") return text.slice(tokenStart);
    return null;
  }
}
