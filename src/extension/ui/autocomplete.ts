import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
  SlashCommand,
} from "@earendil-works/pi-tui";
import { fuzzyFilter } from "@earendil-works/pi-tui";

const PATH_DELIMITERS = new Set([" ", "\t", '"', "'", "="]);

type SuggestOptions = { signal: AbortSignal; force?: boolean };

/**
 * Decorates the framework's built-in autocomplete provider.
 *
 * We own two triggers and intentionally keep tight control over them:
 *  - `@` → account / payee / tag mentions
 *  - `/` → a curated slash-command list (only the commands we choose to expose,
 *          not the framework's full command set)
 *
 * Everything else (file-path completion) is delegated to the wrapped built-in
 * provider. Registered via `ctx.ui.addAutocompleteProvider()`, which passes the
 * built-in provider as the delegate and re-applies us to the editor — so no
 * monkey-patching of the editor is required.
 */
export class AccountantAutocompleteProvider implements AutocompleteProvider {
  private delegate: AutocompleteProvider | null = null;
  private commands: SlashCommand[] = [];
  private accounts: string[] = [];
  private payees: string[] = [];
  private tags: string[] = [];

  setDelegate(delegate: AutocompleteProvider): void {
    this.delegate = delegate;
  }

  setCommands(commands: SlashCommand[]): void {
    this.commands = commands;
  }

  setData(accounts: string[], payees: string[], tags: string[]): void {
    this.accounts = accounts;
    this.payees = payees;
    this.tags = tags;
  }

  get triggerCharacters(): string[] | undefined {
    return this.delegate?.triggerCharacters;
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options?: SuggestOptions,
  ): Promise<AutocompleteSuggestions | null> {
    const line = lines[cursorLine] || "";
    const before = line.slice(0, cursorCol);

    // @ trigger: payee/account/tag mentions
    const atPrefix = this.extractAtPrefix(before);
    if (atPrefix) {
      const query = atPrefix.slice(1); // remove leading @
      const items: AutocompleteItem[] = [
        ...this.accounts.map((a) => ({ value: a, label: a, description: "account" })),
        ...this.payees.map((p) => ({ value: p, label: p, description: "payee" })),
        ...this.tags.map((t) => ({ value: t, label: t, description: "tag" })),
      ];
      const filtered = query ? fuzzyFilter(items, query, (item) => item.label) : items;
      if (filtered.length === 0) return null;
      return { items: filtered, prefix: atPrefix };
    }

    // / trigger: curated slash commands (we deliberately do NOT delegate here,
    // so only our chosen commands are offered)
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
      const argumentSuggestions = await command.getArgumentCompletions(argumentText);
      if (!argumentSuggestions || argumentSuggestions.length === 0) return null;
      return { items: argumentSuggestions, prefix: argumentText };
    }

    // Everything else (file paths) is the built-in provider's job.
    const opts = options ?? { signal: new AbortController().signal };
    return this.delegate ? this.delegate.getSuggestions(lines, cursorLine, cursorCol, opts) : null;
  }

  applyCompletion(lines: string[], cursorLine: number, cursorCol: number, item: AutocompleteItem, prefix: string) {
    const line = lines[cursorLine] || "";
    const before = line.slice(0, cursorCol);
    const beforePrefix = line.slice(0, cursorCol - prefix.length);
    const after = line.slice(cursorCol);
    const newLines = [...lines];

    // @ mention completion — insert value with trailing space
    if (this.extractAtPrefix(before)) {
      newLines[cursorLine] = `${beforePrefix}${item.value} ${after}`;
      return { lines: newLines, cursorLine, cursorCol: beforePrefix.length + item.value.length + 1 };
    }

    // Slash command completion
    if (before.startsWith("/")) {
      // Command name — insert with leading / and trailing space
      if (prefix.startsWith("/") && beforePrefix.trim() === "" && !prefix.slice(1).includes("/")) {
        newLines[cursorLine] = `${beforePrefix}/${item.value} ${after}`;
        return { lines: newLines, cursorLine, cursorCol: beforePrefix.length + item.value.length + 2 };
      }
      // Command argument — insert verbatim
      newLines[cursorLine] = `${beforePrefix}${item.value}${after}`;
      return { lines: newLines, cursorLine, cursorCol: beforePrefix.length + item.value.length };
    }

    // Everything else (file paths) → delegate
    if (this.delegate) return this.delegate.applyCompletion(lines, cursorLine, cursorCol, item, prefix);

    // Fallback (no delegate) — replace the prefix with the raw value
    newLines[cursorLine] = `${beforePrefix}${item.value}${after}`;
    return { lines: newLines, cursorLine, cursorCol: beforePrefix.length + item.value.length };
  }

  shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean {
    return this.delegate?.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
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
