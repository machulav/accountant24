import { readFileSync, writeFileSync } from "node:fs";
import { generateDiffString } from "@earendil-works/pi-coding-agent";

// A buffered, snapshot-backed editor for a set of journal files.
//
// Ledger writers (add_transactions, modify_transactions) all follow the same shape: read
// some files, edit them, write the batch to disk, run `hledger check` over the whole
// ledger, then keep the writes if valid or revert them if not. This class owns that
// read/write/flush/restore machinery so each tool only supplies the domain-specific edits.
//
// The model has two layers: the on-disk files and an in-memory staging copy. `read` seeds
// both from disk on first touch (the snapshot is the rollback target); `write` mutates the
// staging copy only. `flush` then persists the staged changes and remembers exactly which
// files it wrote, so `restore` can put those — and only those — back byte-for-byte.
//
// It is not reentrant against itself and does no locking; ledger writers serialize by
// running as executionMode "sequential" tools (pi never runs them concurrently). It only
// edits files that already exist (creation/deletion is not modeled yet — see the
// add_transactions migration).

export type JournalDiff = { fullFilePath: string; diff: string };

export class JournalEditSession {
  /** Original on-disk content, captured once on first touch — the rollback target. */
  private readonly snapshot = new Map<string, string>();
  /** Staged content: starts equal to the snapshot, diverges as `write` is called. */
  private readonly current = new Map<string, string>();
  /** Absolute paths that the most recent `flush` actually wrote. */
  private written: string[] = [];

  /** Return a file's staged content, reading it from disk (and snapshotting it) on first touch. */
  read(absPath: string): string {
    let content = this.current.get(absPath);
    if (content === undefined) {
      content = readFileSync(absPath, "utf-8");
      this.snapshot.set(absPath, content);
      this.current.set(absPath, content);
    }
    return content;
  }

  /** Stage new content for a file. Nothing reaches disk until `flush`. */
  write(absPath: string, content: string): void {
    this.current.set(absPath, content);
  }

  /**
   * Write every file whose staged content differs from its snapshot, skipping unchanged
   * files to avoid needless churn. Records what it wrote so `restore` can revert exactly
   * those files. Returns the paths written.
   */
  flush(): string[] {
    this.written = [];
    for (const [absPath, content] of this.current) {
      if (content === this.snapshot.get(absPath)) continue;
      writeFileSync(absPath, content);
      this.written.push(absPath);
    }
    return this.written;
  }

  /** Rewrite exactly the files the last `flush` wrote back to their snapshot content. */
  restore(): void {
    for (const absPath of this.written) {
      const orig = this.snapshot.get(absPath);
      if (orig !== undefined) writeFileSync(absPath, orig);
    }
  }

  /** A unified diff (snapshot -> staged) for every file whose content changed. */
  diff(): JournalDiff[] {
    const diffs: JournalDiff[] = [];
    for (const [absPath, orig] of this.snapshot) {
      const cur = this.current.get(absPath) ?? orig;
      if (cur === orig) continue;
      diffs.push({ fullFilePath: absPath, diff: generateDiffString(orig, cur).diff });
    }
    return diffs;
  }
}
