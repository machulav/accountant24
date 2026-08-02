import { isValidCalendarDate } from "./dates";
import { segment } from "./segment";
import type { Block } from "./types";

export interface DatedEntry {
  /** Index of the block in `blocks`. */
  index: number;
  date: string;
  block: Block;
}

/**
 * A journal file as an ordered list of blocks, edited conservatively: blocks
 * that are never touched keep their exact original bytes through `serialize()`.
 * Only inserted or replaced blocks are rendered — so a gap in the parser can
 * at worst refuse an edit, never corrupt content it did not understand.
 */
export class JournalDoc {
  private items: Block[];
  private readonly eol: string;

  private constructor(text: string) {
    this.items = segment(text);
    this.eol = text.includes("\r\n") ? "\r\n" : "\n";
  }

  static open(text: string): JournalDoc {
    return new JournalDoc(text);
  }

  get blocks(): readonly Block[] {
    return this.items;
  }

  /** Dated entries (transactions and P directives) in file order. */
  entries(): DatedEntry[] {
    const result: DatedEntry[] = [];
    for (let i = 0; i < this.items.length; i++) {
      const block = this.items[i];
      if ((block.kind === "transaction" || block.kind === "price") && block.date) {
        result.push({ index: i, date: block.date, block });
      }
    }
    return result;
  }

  /**
   * Insert a rendered entry (transaction or P directive) in date order: after
   * the last entry dated on or before `date`. A comment block sitting directly
   * above a transaction travels with that transaction and is never separated
   * from it. Blocks other than the insertion seam keep their exact bytes.
   */
  insertEntry(entryText: string, date: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD.`);
    }
    if (!isValidCalendarDate(date)) {
      throw new Error(`Invalid date: ${date}. That calendar day does not exist.`);
    }
    const block = this.toBlock(entryText);
    if (block.kind !== "transaction" && block.kind !== "price") {
      throw new Error(`Entry text must be a single transaction or P directive, got a ${block.kind} block.`);
    }
    if (block.date !== date) {
      throw new Error(`The entry text is dated ${block.date ?? "unparseably"}, which does not match ${date}.`);
    }
    this.spliceIn(this.insertionIndex(date), block);
  }

  /** Replace one block's text in place (no seam handling). */
  replaceBlock(index: number, text: string): void {
    if (index < 0 || index >= this.items.length) {
      throw new Error(`Block index ${index} is out of range (0..${this.items.length - 1}).`);
    }
    this.items[index] = this.toBlock(text);
    this.renumber();
  }

  /** Append a block at the end of the file, blank-line separated. */
  appendBlock(text: string): void {
    this.spliceIn(this.items.length, this.toBlock(text));
  }

  /** Concatenation of all block bytes; untouched blocks are byte-identical. */
  serialize(): string {
    return this.items.map((b) => b.raw).join("");
  }

  // ── Internals ─────────────────────────────────────────────────────

  /** Render text in the doc's newline style, with a trailing terminator, and
   *  require it to be exactly one block. */
  private toBlock(text: string): Block {
    let rendered = text.replace(/\r?\n/g, this.eol);
    if (!rendered.endsWith(this.eol)) rendered += this.eol;
    const segments = segment(rendered);
    if (segments.length !== 1) {
      throw new Error(`Block text must segment to exactly one block, got ${segments.length}.`);
    }
    return segments[0];
  }

  private insertionIndex(date: string): number {
    const dated = this.entries();
    if (dated.length === 0) return this.items.length;

    let anchor: DatedEntry | undefined;
    for (const entry of dated) {
      if (entry.date <= date) anchor = entry;
    }

    if (!anchor) {
      // Earlier than everything: before the first entry, and before a comment
      // block glued to it (no blank line in between).
      let index = dated[0].index;
      if (index > 0 && this.items[index - 1].kind === "comment") index -= 1;
      return index;
    }

    let index = anchor.index + 1;
    const next = this.items[index];
    if (next?.kind === "comment") {
      // A comment glued under the anchor: it belongs to the next transaction
      // when it directly touches one, otherwise it trails the anchor.
      const after = this.items[index + 1];
      const belongsToNext = after !== undefined && (after.kind === "transaction" || after.kind === "price");
      if (!belongsToNext) index += 1;
    }
    return index;
  }

  /** Splice a block in, normalizing only the seams: a missing terminator on the
   *  previous block is completed, and exactly one blank line separates the new
   *  block from non-blank neighbours. */
  private spliceIn(index: number, block: Block): void {
    const previous = this.items[index - 1];
    if (previous && !previous.raw.endsWith("\n")) {
      previous.raw += this.eol;
    }

    const inserted: Block[] = [block];
    if (previous && previous.kind !== "blank") {
      inserted.unshift({ kind: "blank", raw: this.eol, startLine: 0, endLine: 0 });
    }
    const following = this.items[index];
    if (following && following.kind !== "blank") {
      inserted.push({ kind: "blank", raw: this.eol, startLine: 0, endLine: 0 });
    }

    this.items.splice(index, 0, ...inserted);
    this.renumber();
  }

  private renumber(): void {
    let line = 1;
    for (const block of this.items) {
      const newlines = (block.raw.match(/\n/g) ?? []).length;
      const count = block.raw.endsWith("\n") ? newlines : newlines + 1;
      block.startLine = line;
      block.endLine = line + count - 1;
      line += count;
    }
  }
}
