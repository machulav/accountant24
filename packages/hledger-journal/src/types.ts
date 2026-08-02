export type BlockKind = "transaction" | "price" | "directive" | "comment" | "blank" | "other";

export interface Block {
  kind: BlockKind;
  /** Exact byte slice of the source, including its line terminators. */
  raw: string;
  /** 1-indexed first line of the block in the source. */
  startLine: number;
  /** 1-indexed last line of the block in the source. */
  endLine: number;
  /** Normalized ISO date for dated entries (transaction/price); undefined when unparseable. */
  date?: string;
}

export interface Tag {
  name: string;
  value?: string;
}

export interface Posting {
  account: string;
  /** Numeric amount; absent for an elided (balancing) posting. */
  amount?: number;
  /** The amount exactly as written (sign and decimals preserved); rendering uses this, never the number. */
  amountText?: string;
  currency?: string;
  assertion?: { amount: number; amountText: string; currency: string };
  /** Trailing comment, verbatim from the ";" to the end of the line. */
  comment?: string;
  /** True for a parenthesized (unbalanced virtual) posting. */
  virtual?: boolean;
}

export interface Transaction {
  /** Normalized ISO date (YYYY-MM-DD). */
  date: string;
  /** Status marker; undefined when unmarked. */
  status?: "*" | "!";
  code?: string;
  /** Full description verbatim: the header text after date/status/code, before any comment. */
  description: string;
  /** Derived: description before the first "|", trimmed. */
  payee: string;
  /** Derived: description after the first "|", trimmed; undefined when there is no "|". */
  note?: string;
  /** Header comment, verbatim from the ";" to the end of the line. */
  headerComment?: string;
  /** Indented comment lines between the header and the first posting, each verbatim from its ";". */
  commentLines: string[];
  /** Tags derived from single-tag comment lines ("; name:" or "; name: value"). */
  tags: Tag[];
  postings: Posting[];
}

export interface PriceDirective {
  /** Normalized ISO date (YYYY-MM-DD). */
  date: string;
  commodity: string;
  amount: number;
  /** The amount exactly as written; rendering uses this, never the number. */
  amountText: string;
  currency: string;
}

export interface FormatConfig {
  /** Leading whitespace of posting/comment lines. */
  indent: string;
  /** 0-indexed column where an amount's first digit lands; a minus sign hangs one column left. */
  alignColumn: number;
}
