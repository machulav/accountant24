import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type BulkEditField, type BulkEditParams, type BulkEditResult, bulkEditTransactions } from "../ledger";
import { TOOL_LABELS } from "../tool-labels";

const Params = Type.Object({
  query: Type.Array(Type.String(), {
    minItems: 1,
    description:
      'hledger query terms targeting the transactions to edit, each an array element (ANDed), e.g. ["payee:EDEKA", "acct:expenses:uncategorized"] or ["date:2026-06", "desc:whole foods"]. Put a whole term (even with spaces) in one element; do not add quotes.',
  }),
  action: Type.Union([Type.Literal("change_account"), Type.Literal("change_payee"), Type.Literal("set_status")], {
    description:
      "The bulk edit to apply to every matching transaction: 'change_account' moves postings from account `from` to account `to`; 'change_payee' renames the payee `from` to `to`; 'set_status' sets the transaction status marker to `to`.",
  }),
  from: Type.Optional(
    Type.String({
      description:
        "Required for change_account and change_payee: the exact current value being replaced (the account of the posting to move, or the payee to rename). Acts as a guard: matched transactions whose value differs are left untouched, so a fuzzy query never edits the wrong ones. Not used by set_status.",
    }),
  ),
  to: Type.String({
    description:
      "The new value: for change_account the new account (e.g. expenses:food:groceries); for change_payee the new payee name; for set_status one of 'cleared', 'pending', or 'unmarked'.",
  }),
  dry_run: Type.Optional(
    Type.Boolean({
      description: "Preview the diff and validation result without writing any changes (default false).",
    }),
  ),
});

/** Tool actions mapped onto the ledger layer's field vocabulary. */
const ACTION_FIELDS = {
  change_account: "account",
  change_payee: "payee",
  set_status: "status",
} as const;

/** Ledger-layer errors name BulkEditParams fields; resurface them under this tool's schema names. */
function renameParamsInError(e: unknown): unknown {
  if (!(e instanceof Error)) return e;
  const msg = e.message.replace(/\bfrom_(?:account|payee)\b/g, "from").replace(/\bnew_value\b/g, "to");
  return msg === e.message ? e : new Error(msg);
}

export const bulkEditTransactionsTool: ToolDefinition<typeof Params, BulkEditResult> = {
  name: "bulk_edit_transactions",
  label: TOOL_LABELS.bulk_edit_transactions,
  description:
    "Run an hledger query and apply one bulk edit to every matching transaction: change a posting's account, change the payee, or set the status. Edits are surgical; the ledger is validated and the whole batch reverts on error.",
  promptSnippet: "Bulk-edit transactions matching an hledger query (change account, change payee, or set status)",
  promptGuidelines: [
    "bulk_edit_transactions targets transactions with a standard hledger query (e.g. payee:, desc:, acct:, date:, status:), then applies one `action` to all of them.",
    "bulk_edit_transactions change_account moves postings whose account exactly equals `from` into `to`; other postings are never touched. Ensure `to` is declared in accounts.journal or the strict check fails and the whole batch reverts.",
    "bulk_edit_transactions change_payee renames the payee `from` (exact match) to `to`, preserving the date, status, description, and comments. Matched transactions with a different payee are left untouched, so a fuzzy query can never rename the wrong one.",
    "bulk_edit_transactions set_status sets the header status marker on every match: `to` is 'cleared' (*), 'pending' (!), or 'unmarked' (no marker). It assigns the status regardless of the current one; to restrict by current status, add a status: query term. Posting-level markers are left untouched.",
    "bulk_edit_transactions query terms are case-insensitive regex substrings (payee:DB also matches 'GOLDBACH', desc:shell matches 'Michelle'); anchor to be precise, e.g. payee:^EDEKA$, and prefer narrow terms.",
    "For broad or unfamiliar queries, call bulk_edit_transactions with dry_run: true first to review the diff, then apply. Call commit_and_push after a batch of related edits.",
  ],
  // Serialize every ledger write: "sequential" makes pi run any batch containing this
  // tool one call at a time, so concurrent read/edit/write/validate cycles never
  // interleave on shared journal files.
  executionMode: "sequential",
  parameters: Params,

  async execute(_id, params, signal) {
    if (params.action !== "set_status" && (!params.from || params.from.trim() === "")) {
      const noun = params.action === "change_account" ? "account" : "payee";
      throw new Error(`from is required for ${params.action}: the exact current ${noun} being replaced.`);
    }
    const spec: BulkEditParams = {
      // Unknown actions (possible only when the schema is bypassed) fall through
      // verbatim so the ledger layer's "Unsupported field" error names them.
      field: (ACTION_FIELDS[params.action] ?? params.action) as BulkEditField,
      new_value: params.to,
      from_account: params.action === "change_account" ? params.from : undefined,
      from_payee: params.action === "change_payee" ? params.from : undefined,
    };

    let result: BulkEditResult;
    try {
      result = await bulkEditTransactions(params.query, spec, params.dry_run ?? false, signal);
    } catch (e) {
      throw renameParamsInError(e);
    }

    const verb = result.dryRun ? "Would modify" : "Modified";
    const detail =
      result.field === "account"
        ? `${result.postings} posting(s) across ${result.transactions} transaction(s) -> ${params.to}`
        : result.field === "payee"
          ? `${result.transactions} payee(s) renamed to "${params.to}"`
          : `${result.transactions} transaction(s) marked ${params.to}`;

    const lines = [`${verb}: ${detail} (query: ${result.query.join(" ")}).`];
    if (result.dryRun) {
      lines.push(
        result.ledgerIsValid ? "Ledger would remain valid." : `Ledger would be INVALID:\n${result.validationError}`,
      );
    }
    for (const w of result.warnings) lines.push(`Warning: ${w}`);

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: result,
    };
  },
};
