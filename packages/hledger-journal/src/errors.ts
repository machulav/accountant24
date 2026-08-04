/** A journal block (or line) the strict parser refuses to interpret. The block is
 *  never guessed at — callers must leave its text untouched. */
export class JournalParseError extends Error {
  /** 1-indexed line in the source file the error points at. */
  readonly line: number;
  readonly reason: string;

  constructor(reason: string, line: number) {
    super(`Line ${line}: ${reason}`);
    this.name = "JournalParseError";
    this.line = line;
    this.reason = reason;
  }
}
