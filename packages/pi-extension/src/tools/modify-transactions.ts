import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type ModifyParams, type ModifyResult, modifyTransactions } from "../ledger";

const Params = Type.Object({
  query: Type.Array(Type.String(), {
    minItems: 1,
    description:
      'hledger query terms targeting the transactions to edit, each an array element (ANDed), e.g. ["payee:EDEKA", "acct:expenses:uncategorized"] or ["date:2026-06", "desc:whole foods"]. Put a whole term (even with spaces) in one element; do not add quotes.',
  }),
  field: Type.Union([Type.Literal("account"), Type.Literal("payee")], {
    description:
      "The field to change on each matching transaction: 'account' moves a posting to a different account; 'payee' renames the payee.",
  }),
  new_value: Type.String({
    description:
      "The replacement value: for field 'account' the new account (e.g. expenses:food:groceries); for field 'payee' the new payee name.",
  }),
  from_account: Type.Optional(
    Type.String({
      description:
        "Required when field is 'account': the exact current account of the posting to change, e.g. expenses:uncategorized.",
    }),
  ),
  from_payee: Type.Optional(
    Type.String({
      description:
        "Required when field is 'payee': the exact current payee to rename. Matched transactions whose payee differs are left untouched, so a fuzzy query never renames the wrong payee.",
    }),
  ),
  dry_run: Type.Optional(
    Type.Boolean({
      description: "Preview the diff and validation result without writing any changes (default false).",
    }),
  ),
});

const LABEL = "Modify Transactions";

export const modifyTransactionsTool: ToolDefinition<typeof Params, ModifyResult> = {
  name: "modify_transactions",
  label: LABEL,
  description:
    "Run an hledger query and change one field on every matching transaction: move a posting to a different account, or rename the payee. Edits are surgical; the ledger is validated and the whole batch reverts on error.",
  promptSnippet: "Bulk-edit a field (account or payee) on transactions matching an hledger query",
  promptGuidelines: [
    "modify_transactions targets transactions with a standard hledger query (e.g. payee:, desc:, acct:, date:), then changes one `field` on all of them.",
    "field 'account' moves postings in `from_account` (exact match) into `new_value`; other postings are never touched. Ensure `new_value` is declared in accounts.journal or the strict check fails and the whole batch reverts.",
    "field 'payee' renames the payee `from_payee` (exact match) to `new_value`, preserving the date, status, description, and comments. Matched transactions with a different payee are left untouched, so a fuzzy query can never rename the wrong one.",
    "hledger query terms are case-insensitive regex substring matches, so payee:DB also matches 'GOLDBACH' and desc:shell matches 'Michelle'. Anchor to be precise, e.g. payee:^EDEKA$, and prefer narrow terms.",
    "For broad or unfamiliar queries, run with dry_run: true first to review the diff, then apply. Call commit_and_push after a batch of related edits.",
  ],
  // Serialize every ledger write: "sequential" makes pi run any batch containing this
  // tool one call at a time, so concurrent read/edit/write/validate cycles never
  // interleave on shared journal files.
  executionMode: "sequential",
  parameters: Params,

  async execute(_id, params, signal) {
    const spec: ModifyParams = {
      field: params.field,
      new_value: params.new_value,
      from_account: params.from_account,
      from_payee: params.from_payee,
    };
    const result = await modifyTransactions(params.query, spec, params.dry_run ?? false, signal);

    const verb = result.dryRun ? "Would modify" : "Modified";
    const detail =
      result.field === "account"
        ? `${result.postings} posting(s) across ${result.transactions} transaction(s) -> ${params.new_value}`
        : `${result.transactions} payee(s) renamed to "${params.new_value}"`;

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
