// Shared constants and types for the journal formatter pipeline.

export const MIN_GAP = 4;
// Minimum 0-indexed column where the first digit of every amount should
// land. Short-account files are padded out to this column; files with
// unusually long accounts push the amount column further right.
export const MIN_AMOUNT_COLUMN = 70;
export const DATE_HEADER_REGEX = /^(\d{4})[-/.](\d{2})[-/.](\d{2})\b/;

export interface Transaction {
  date: string;
  header: string;
  body: string[];
  // Non-indented content that appeared between the previous transaction's
  // body and this transaction's header. Emitted before this transaction's
  // header and moves with the transaction under sort.
  preContent: string[];
}

export type ParsedBodyLine =
  | { kind: "metadata"; raw: string }
  | { kind: "balancing"; raw: string }
  | {
      kind: "posting";
      indent: string;
      account: string;
      amount: string;
      digitsPrefixLength: number;
      isNegative: boolean;
    }
  | { kind: "other"; raw: string };

export interface PostingGroup {
  parsed: ParsedBodyLine; // posting | balancing | other
  trailing: string[]; // raw comments / other lines attached to this posting
}

export interface ParsedContent {
  lines: string[];
  hadTrailingNewline: boolean;
}

export interface CategorizedBody {
  tagLines: string[];
  headerNonTag: string[];
  postingGroups: PostingGroup[];
}

export interface PartitionedPostings {
  negatives: PostingGroup[];
  positives: PostingGroup[];
  balancings: PostingGroup[];
}
