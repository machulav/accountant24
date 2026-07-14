---
name: subscription-audit
description: Use when the user asks about subscriptions, recurring payments, memberships, or regular charges, e.g. "what am I paying monthly", "list my subscriptions", "what can I cancel", "when does X renew", "did Netflix get more expensive". Detects recurring charges in the ledger, builds a subscription overview with renewal expectations, and flags price increases, duplicates, and likely-cancelled services.
---

# Subscription Audit

Find recurring charges in the ledger, present them as one subscription overview,
and flag anomalies. This is a read-only analysis: use the `query` tool only —
never modify the journal in this workflow.

## Detecting subscriptions

1. Pull the last 12 months of expense postings in machine-readable form with the
   `query` tool: `report: "reg"`, `account_pattern: "Expenses"`,
   `begin_date: <12 months ago>`, `output_format: "csv"`. For large ledgers,
   narrow with `payee_pattern` on follow-up queries instead of re-pulling.
2. Group postings by payee. A payee is a subscription candidate when all hold:
   - it appears in **3 or more distinct months** (or twice, ~1 year apart, for
     annual plans), and
   - the interval between charges is regular — monthly ±4 days, weekly ±1 day,
     quarterly ±1 week, yearly ±2 weeks, and
   - the amounts are identical or step between two stable values (a step is a
     price change, not a disqualifier — record it).
3. Regularity beats frequency: payees with irregular gaps or widely varying
   amounts (groceries, restaurants, fuel) are not subscriptions.
4. Payee spelling drifts ("Netflix" vs "NETFLIX.COM" vs "Netflix.com Amsterdam")
   — normalize case and punctuation when grouping, and say which payees you
   merged so the user can correct you.

## Reporting

Present a single table sorted by monthly-equivalent cost, then totals:

| Subscription | Cadence | Amount | ≈ Monthly | Last charged | Next expected |

- **Next expected** = last charge date + cadence. Flag anything whose expected
  date is more than one full cadence in the past as *probably cancelled* — list
  it separately, don't count it in the totals.
- Show the total per month and per year in the ledger's own currency; if
  several currencies appear, keep separate totals per currency — do not convert
  unless the user asks.

After the table, call out only what's noteworthy:

- **Price increases** — same payee, higher amount between consecutive charges:
  show old → new and the percentage.
- **Possible duplicates** — overlapping services of the same kind (two music
  streaming payees, two cloud-storage payees).
- **Annual renewals coming up** within the next 60 days.

## Boundaries

- If the ledger covers less than ~3 months, say the history is too short for a
  reliable audit instead of guessing.
- Cancellation is the user's action in the outside world — you can only report;
  never remove or edit journal entries as part of this audit.
