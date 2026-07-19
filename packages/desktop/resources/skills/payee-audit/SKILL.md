---
name: payee-audit
description: Reviews how your payees are categorised and flags mis-categorised ones - payees posting to the wrong expense account, to inconsistent accounts, or to expenses:uncategorized. Also spots spelling variants of the same payee (e.g. "NETFLIX.COM" vs "Netflix") and proposes unifying them first, so the category fix that follows is one change instead of several. Best run after setting up accounts or after a large import. Detects and reports read-only, then offers to apply the corrections for you once you confirm. Ask things like "validate my categories", "are my payees categorised correctly", "check for miscategorised transactions", "which payees are in the wrong account", or "do I have duplicate payee names". This is about category correctness, not recurrence - for bills and subscriptions, use the recurring-spending or subscription-audit skills instead.
---

# Payee Audit

Surface payees whose expense category (account) is wrong, inconsistent, or
questionable, and propose a corrected mapping for each - after first proposing
to unify any spelling variants of the same payee, so the category fix that
follows is one edit instead of several. Detecting and reporting is
**read-only**: use the `query` tool to read the ledger, and the bundled
`map_payees.py` script (via `bash`) only to collapse that output into a payee
-> account map - never edit, validate, or commit the journal while building
the report. Once findings are presented, offer to apply them yourself: use
whatever modify tool is available in this build (or the built-in `edit` tool
on the monthly journal files), then validate and commit - but only after the
user confirms which corrections to apply. Don't make the user do the
mechanical work of applying a fix themselves; that's the point of offering.

Best run periodically - after setting up the chart of accounts, or after a large
bank/CSV import, when mis-categorisations are most likely.

## Building the payee -> account map

1. Pull every expense posting in machine-readable form with the `query` tool:
   `report: "reg"`, `account_pattern: "expenses"`, `output_format: "tsv"`.
   Every rubric below (Correct/Wrong/Unsure, Common wrong patterns) judges an
   *expense* category, so scope to expenses only - pulling income too would
   just add unclassifiable noise. `account_pattern: "expenses"` already
   excludes transfers, opening balances, and reconciliations - they post to
   assets/liabilities/equity - so no payee skip-list is needed.
   - On a ledger with much history this can run past the query tool's inline
     size limit - it then writes the tsv to a scratch file itself and tells
     you the path instead of returning the rows. Use that path in step 2
     rather than re-running the query or copying the rows into a file
     yourself.
2. Run the bundled script with `bash` to collapse the tsv deterministically:
   `python3 <skill directory>/map_payees.py <tsv path>`. This invocation
   itself tells you `<skill directory>`: right above this text is a line
   reading "References are relative to `<path>`." - that `<path>` is the
   directory this file lives in; use it directly, do not guess an absolute
   path. `<tsv path>` is either the scratch file from step 1, or - if the
   query returned the rows inline because the ledger is small - a temp path
   you create with `bash`, e.g. `mktemp` plus a heredoc. Either way keep
   scratch data out of the git-tracked workspace (never `files/`) - use a real
   OS temp path. Do not write ad-hoc bash/awk to group the rows yourself; that
   is exactly what the script does. It needs only Python's standard library
   (no pip install).
   - Output: one line per payee, tab-separated - an optional `MULTI` flag,
     the payee, then `account (count)` pairs sorted by count descending.
     `MULTI` marks payees posting to more than one account; a single-account
     payee can still be miscategorised (see Classifying below).
   - If `python3` is not on PATH, fall back to collapsing the tsv yourself
     (group by payee, count accounts) - slower and more error-prone, but keeps
     the skill working everywhere.

## Unifying payee names first

Before classifying accounts, scan the raw payee list from step 2 for spelling
variants of the same real-world merchant - the script deliberately does not
group these itself (judging which strings are the same merchant, and what to
call the merged result, needs real judgment, not a heuristic). Do this first:
once a group of variants is unified under one canonical name, the account
correction that follows is a single edit against that name ("recategorize
Netflix to expenses:subscriptions") instead of a separate edit per spelling.

- Look for case/punctuation/domain-suffix differences ("NETFLIX.COM",
  "Netflix", "Netflix.com") - these are almost always the same merchant.
- Be more careful with location suffixes or abbreviations ("Shell" vs "Shell
  Amsterdam", "Whole Foods" vs "WF Market") - confirm they share a consistent
  account and transaction pattern before treating them as one payee; don't
  merge two genuinely different merchants just because their names are
  similar.
- For each confirmed group, note the total posting count (sum the
  per-account counts from step 2 across all variants in the group) - that
  tells the user how large the rename is before they commit to it. This counts
  postings, not distinct transactions - a transaction split across two expense
  postings (e.g. groceries and alcohol on one receipt) counts twice; call that
  out rather than presenting it as an exact transaction count.
- Propose the unification; do not merge anything in the journal yourself.

## Classifying each payee

Judge every **unified** payee (variants merged under their canonical name)
against its account(s) and sort into three buckets. The full map must be
reviewed - a payee mapping consistently to a single *wrong* account is just as
much a bug as an inconsistent one, and only reading the mapping catches it.

### Correct
The payee clearly matches its account and maps to one reasonable account.
Examples: a supermarket -> groceries, a gas station -> fuel, a streaming service
-> subscriptions, a phone carrier -> utilities:phone, an insurer -> insurance.

### Wrong
Any of:
- **Name contradicts the account** - a gas station under groceries, an airline
  under shopping.
- **Bank-category bleed** - the bank's own label was kept instead of the real
  merchant type (supermarkets landing in "Merchandise"/"Shopping" from a card
  import).
- **Uncategorised** - posts to `expenses:uncategorized`, never reviewed after
  import.
- **Inconsistent** - the same unified payee maps to more than one expense
  account with no real reason (combine the account counts from step 2 across
  its variants to see this clearly - unifying first is what surfaces cases
  that were hidden behind two different spellings each posting to a different
  account). A genuine split is fine (an Amazon device vs Amazon groceries) -
  judge the series, don't flag a payee wholesale.

### Unsure
Can't decide without more context - flag for the user rather than guessing:
- General/department or merchandise stores (clothing? household? electronics?).
- Drugstores and multi-purpose shops (toiletries and food).
- Peer-to-peer payments (Venmo, Zelle, PayPal) - depends what was paid for.
- Hardware / auto-parts stores - a home project or a car repair.
- Online marketplaces (Amazon, eBay) where the item bought is unknown.

## Reporting

Present findings, most actionable first.

- **Unify payee names** - if any spelling-variant groups were found, a table
  presented before the account corrections (unifying first is what makes those
  corrections a single edit instead of several):

  | Raw spellings found | Suggested canonical name | Postings affected |

  Say why they're the same merchant. Skip this table entirely when no
  variants were found - don't force an empty section.
- **Wrong** - a table the user can act on:

  | Payee (as it appears in the journal) | Current account | Suggested account | Why |

  The journal still has the raw spellings until a proposed rename is actually
  applied - so for a unified payee, list every raw spelling as its own row
  (each with its own current account, since variants can differ) rather than
  the canonical name alone. A modify tool acting on this table needs the real,
  currently-matching payee strings; the canonical name only exists once the
  Unify table above has been applied. Suggest a target account that already
  exists in the ledger (cross-check against the accounts list); if none fits,
  say a new account is needed rather than inventing one.
- **Unsure** - a short list, each with the single question that would resolve it
  ("Amazon - was this the Prime membership or a purchase?").
- **Correct** - just a count ("31 payees look correctly categorised"); don't
  enumerate them.

Offer to apply the findings: ask which corrections the user wants (all of
them, just one table, one row at a time), then make the change with whatever
modify tool is available in this build (a dedicated modify tool, or the
built-in `edit` tool on the monthly journal files), validate, and commit.
Apply unification renames before account fixes - it turns each Wrong row's
list of raw spellings into one payee, so the account fix that follows is one
edit instead of several.

## Common wrong patterns

| Payee pattern | Wrong account | Likely right | Root cause |
|---|---|---|---|
| Gas station that also sells food | groceries | transport:fuel | Combined store + pump |
| Supermarket from a card import | shopping | food:groceries | Bank category = "Merchandise" |
| Subscription / SaaS | shopping | subscriptions:* | Import missed the merchant type |
| Anything in expenses:uncategorized | uncategorized | varies | Never reviewed post-import |

## Boundaries

- **Read-only while detecting and reporting.** Never edit, validate, or commit
  the journal while building the payee -> account map or the findings report.
- **Confirm before applying.** After presenting findings, offer to apply the
  corrections yourself - never edit, validate, or commit until the user has
  confirmed which ones they want.
- Don't invent target accounts - suggest only accounts that already exist in the
  ledger, or say a new one is needed.
- Don't merge payees on name similarity alone - two different real-world
  merchants can have similar names. Confirm a shared account pattern before
  proposing a unification, and when unsure, leave them separate rather than
  guessing.
- If the ledger is nearly empty or freshly scaffolded, say there is not enough
  history to validate instead of guessing.
- The tsv scratch file (wherever it ends up - the query tool's own spillover
  file, or one you created with `mktemp`) is throwaway data, not a ledger
  record - never write it under `files/` or anywhere else in the git-tracked
  workspace.
