import { JournalParseError } from "./errors";
import { DEFAULT_FORMAT, renderPrice, renderTransaction } from "./format";
import { parsePriceBlock, parseTransactionBlock } from "./parse";
import { segment } from "./segment";
import type { Block, FormatConfig } from "./types";

export interface SkippedBlock {
  startLine: number;
  reason: string;
}

export interface TidyResult {
  text: string;
  skippedBlocks: SkippedBlock[];
}

/** A sortable unit: one dated entry plus the comment glued directly above it. */
interface UnitElement {
  type: "unit";
  raw: string;
  date: string;
}

/** An immovable run: directives, standalone comments, unparseable entries —
 *  preserved byte-for-byte, including the blank lines inside the run. */
interface FixedElement {
  type: "fixed";
  raw: string;
  lastBlockIndex: number;
}

type Element = UnitElement | FixedElement;

/**
 * Sort a journal's dated entries chronologically and re-render each one in the
 * canonical layout. Only entries the strict parser fully understands are
 * touched; everything else (directives, unparseable entries, standalone
 * comments) stays byte-identical, acts as a barrier that entries never cross,
 * and is reported in `skippedBlocks`. Blank lines between sorted units are
 * normalized to exactly one; blank lines inside preserved runs are kept.
 */
export function tidyJournal(text: string, config: FormatConfig = DEFAULT_FORMAT): TidyResult {
  const blocks = segment(text);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const skippedBlocks: SkippedBlock[] = [];
  const elements: Element[] = [];

  const pushFixed = (raw: string, firstIndex: number, lastIndex: number): void => {
    const previous = elements[elements.length - 1];
    if (previous?.type === "fixed") {
      const gap = blankGap(blocks, previous.lastBlockIndex, firstIndex);
      if (gap !== undefined) {
        previous.raw += gap + raw;
        previous.lastBlockIndex = lastIndex;
        return;
      }
    }
    elements.push({ type: "fixed", raw, lastBlockIndex: lastIndex });
  };

  const tryRenderEntry = (block: Block): string | undefined => {
    try {
      return block.kind === "transaction"
        ? renderTransaction(parseTransactionBlock(block), config)
        : renderPrice(parsePriceBlock(block));
    } catch (e) {
      if (e instanceof JournalParseError) {
        skippedBlocks.push({ startLine: block.startLine, reason: e.reason });
        return undefined;
      }
      throw e;
    }
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.kind === "blank") continue;

    const next = blocks[i + 1];
    if (block.kind === "comment" && next && isEntryKind(next)) {
      // The comment is glued to the entry below it; they sort (or stay) together.
      const rendered = tryRenderEntry(next);
      if (rendered !== undefined) {
        elements.push({ type: "unit", raw: block.raw + withEol(rendered, eol), date: next.date as string });
      } else {
        pushFixed(block.raw + next.raw, i, i + 1);
      }
      i += 1;
      continue;
    }

    if (isEntryKind(block)) {
      const rendered = tryRenderEntry(block);
      if (rendered !== undefined) {
        elements.push({ type: "unit", raw: withEol(rendered, eol), date: block.date as string });
      } else {
        pushFixed(block.raw, i, i);
      }
      continue;
    }

    pushFixed(block.raw, i, i);
  }

  sortUnitRuns(elements);

  const parts = elements.map((el) => (el.raw.endsWith("\n") ? el.raw : el.raw + eol));
  return { text: parts.join(eol), skippedBlocks };
}

// ── Internals ───────────────────────────────────────────────────────

function isEntryKind(block: Block): boolean {
  return block.kind === "transaction" || block.kind === "price";
}

function withEol(rendered: string, eol: string): string {
  return rendered.replace(/\n/g, eol) + eol;
}

/** The raw bytes of the blocks strictly between two indices, or undefined if
 *  any of them is not blank (the runs must then stay separate). */
function blankGap(blocks: Block[], fromIndex: number, toIndex: number): string | undefined {
  let gap = "";
  for (let i = fromIndex + 1; i < toIndex; i++) {
    if (blocks[i].kind !== "blank") return undefined;
    gap += blocks[i].raw;
  }
  return gap;
}

/** Stable-sort each maximal run of consecutive units by date; fixed elements
 *  are barriers that units never cross. */
function sortUnitRuns(elements: Element[]): void {
  let runStart = -1;
  for (let i = 0; i <= elements.length; i++) {
    const isUnit = i < elements.length && elements[i].type === "unit";
    if (isUnit && runStart < 0) runStart = i;
    if (!isUnit && runStart >= 0) {
      const run = elements.slice(runStart, i) as UnitElement[];
      run.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      elements.splice(runStart, i - runStart, ...run);
      runStart = -1;
    }
  }
}
