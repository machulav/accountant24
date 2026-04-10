---
name: hledger
description: Plain-text double-entry accounting reference for hledger. Covers journal file syntax, transaction formatting, common commands (check, bal, reg, print, stats, aregister, is, bs), strict validation rules, and typical pitfalls. Use when writing or editing journal entries, debugging hledger errors, answering the user's questions about hledger, or constructing hledger CLI queries.
---

# hledger skill

A compact reference for producing valid hledger journal entries and running hledger commands against the user's ledger.

## Transaction syntax

```
YYYY-MM-DD [*|!] Payee | Narration
    Account:Sub:Sub     AMOUNT CURRENCY
    Account:Sub:Sub    -AMOUNT CURRENCY
```

Rules the agent must respect:
- Date format is always `YYYY-MM-DD`.
- `*` marks a cleared transaction; `!` marks pending. Accountant24 uses `*` by default.
- Description line is `Payee | Narration` (pipe-separated). The payee is required; narration is optional but recommended.
- Posting lines are indented with at least two spaces.
- Each transaction must balance: postings sum to zero per commodity. Leave one posting's amount blank and hledger will infer it — but prefer explicit amounts for auditability.
- Amounts use period as decimal separator: `100.00 EUR`, not `100,00`. Currency goes after the amount, separated by a single space.
- Account hierarchy uses `:` as separator: `Assets:Checking`, `Expenses:Food:Coffee`.
- Transactions are separated by a blank line — hledger uses it as the record delimiter.

## Account naming

Top-level prefixes (case-sensitive): `Assets:`, `Liabilities:`, `Income:`, `Expenses:`, `Equity:`. Sub-accounts are free-form but should match the user's existing chart. Never invent new accounts without user confirmation.

## Common commands

The journal file in this project is `~/Accountant24/ledger/main.journal` (it `include`s monthly files under `ledger/YYYY/MM.journal`). All commands below take `-f main.journal` (or equivalent) and can be narrowed by query filters.

| Goal | Command |
|---|---|
| Validate journal (strict) | `hledger check --strict -f main.journal` |
| Balance sheet | `hledger bs -f main.journal` |
| Income statement | `hledger is -f main.journal` |
| All balances | `hledger bal -f main.journal` |
| Transactions for an account | `hledger reg Expenses:Food -f main.journal` |
| Register with running balance | `hledger aregister Assets:Checking -f main.journal` |
| Raw transactions | `hledger print -f main.journal` |
| Stats overview | `hledger stats -f main.journal` |

Period filters: `-p "this month"`, `-p "2026"`, `-p "2026-01..2026-03"`.
Query terms: bare words match the payee/description; `acct:Food` matches an account regex; `cur:EUR` filters commodity; `date:2026-03` filters by date.

## Validation & error recovery

`hledger check --strict` is the source of truth for "is this journal valid?". Common failures:
- `unbalanced transaction` — postings don't sum to zero. Recompute and fix one side.
- `undeclared account` — `--strict` requires every account to be declared (usually in `accounts.journal`). Either add an `account Foo:Bar` declaration or use an already-declared account.
- `parse error` — usually a missing blank line between transactions, a mis-indented posting, or a malformed date.

The project already exposes helpers in `src/extension/hledger.ts`:
- `runHledger(args, opts)` — throws `HledgerCommandError` on non-zero exit.
- `hledgerCheck(journalPath, opts)` — runs `check --strict` on a single file.

Prefer these over spawning bash directly when writing tools; use bash for ad-hoc read-only queries the user asks for interactively.

## Common pitfalls

- Don't edit journal files with `bash`/`sed`; use the `edit` tool so changes are reviewable and validated.
- Don't forget the blank line between transactions — hledger uses it as the record separator.
- Currency must match the user's configured default unless the user explicitly states otherwise.
- Payee should be the canonical spelling from the known payees list when one exists (`starbucks` → `Starbucks`).
- After any journal modification, run `hledger check --strict` before committing.

## References

- Journal format: https://hledger.org/hledger.html#journal
- Command reference: https://hledger.org/hledger.html#commands
- Query syntax: https://hledger.org/hledger.html#queries
