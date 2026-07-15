---
name: recurring-spending
description: Gives you an overview of everything you pay regularly, including rent, utilities, insurance, loans, phone and internet, plus subscriptions and memberships. Groups them into bills and subscriptions, totals them per month and per year, shows what is due in the next 30 days, and flags price increases and expected payments that stopped arriving. Ask things like "what am I paying monthly", "what are my fixed costs", or "what recurring payments do I have". For a cancel-focused review of just subscriptions, use the subscription-audit skill.
---

# Recurring Spending

Give the user the full picture of what they pay regularly — bills and fixed
obligations plus subscriptions — as one overview with totals and what's coming
up. This is a read-only analysis: use the `query` tool only — never modify the
journal in this workflow.

## Detecting recurring charges

<!-- Duplicated in the subscription-audit skill (which lacks the
     variable-amount relaxation in step 2). Keep the two sections in sync. -->

Before inferring anything: if the journal already encodes recurrence — account
hierarchy like `Expenses:Subscriptions:*` or `Expenses:Rent`, or tags on
postings — trust that structure and use detection only to fill the gaps.

1. Pull the last 13 months of expense postings in machine-readable form with
   the `query` tool: `report: "reg"`, `account_pattern: "Expenses"`,
   `begin_date: <13 months ago>`, `output_format: "csv"`. 13 months, not 12,
   so an annual payment appears twice. For large ledgers, narrow with
   `payee_pattern` on follow-up queries instead of re-pulling.
2. Group postings by payee. A payee is a recurring-charge candidate when all
   hold:
   - it appears in **3 or more distinct months** (or twice, ~1 year apart, for
     annual payments), and
   - the interval between charges is regular — monthly ±4 days, weekly ±1 day,
     quarterly ±1 week, yearly ±2 weeks, and
   - the amounts are identical, step between two stable values (a step is a
     price change, not a disqualifier — record it), or fluctuate within a
     stable band (a metered utility: same payee every month, varying amount).
     Report banded amounts as a range, e.g. "~180–250".
3. Regularity beats frequency: payees with irregular intervals (groceries,
   restaurants, fuel — bought when needed, not on a schedule) are not
   recurring, no matter how often they appear.
4. One payee can hide both a recurring charge and ordinary shopping (Amazon
   orders vs Prime, an Apple device vs Apple Music). Isolate the regular
   series and judge it alone — never flag a payee wholesale.
5. Payee spelling drifts ("Netflix" vs "NETFLIX.COM" vs "Netflix.com
   Amsterdam") — normalize case and punctuation when grouping, and say which
   payees you merged so the user can correct you.
6. Count each real-world charge once: a PayPal-wrapped payment plus the
   underlying merchant, or a card settlement plus the expenses it covers, is
   one charge — keep the expense side only.

## Grouping

Classify each recurring charge by one test — could the user cancel it today,
with no penalty, and keep functioning?

- **Bills and fixed obligations** (no): rent or mortgage, utilities,
  insurance, loan payments, taxes, phone plans, internet, childcare.
- **Subscriptions and memberships** (yes): streaming and music, software and
  SaaS, apps, cloud storage, news and magazines, gym and other memberships,
  recurring donations.

## Reporting

Present two tables — bills first, then subscriptions — with the same columns:

| Payee | Account | Cadence | Amount | ≈ Monthly | Last charged | Next expected | Notes |

- **Payee** = the normalized payee name from the journal (spelling variants
  merged).
- **Account** = the expense account the charge posts to, as the full account
  name (e.g. `Expenses:Utilities`).
- **Notes** = short flags like "amount varies" or "merged from 3 spellings";
  leave the cell empty when there's nothing to note.
- Amount may be a range for variable bills ("~180–250"); use the average for
  the ≈ Monthly column.
- After both tables, show the combined total **per month and per year** in the
  ledger's own currency. If several currencies appear, keep separate totals
  per currency; do not convert unless the user asks.
- If the ledger shows regular income, add context: "your recurring costs are X
  per month, about N% of your income". Skip this silently when income is
  absent or ambiguous.
- **Coming up**: list the payments expected in the next 30 days, ordered by
  date (next expected = last charge date + cadence).

After the tables, call out only what's noteworthy:

- **Price increases** in either group — old → new, the percentage, and the
  per-year impact. A rent or insurance hike is bigger news than a streaming
  bump; lead with it.
- **Expected but not seen** — anything more than one full cadence overdue.
  List it separately, exclude it from the totals, and phrase it neutrally:
  stopped, switched, or cancelled — the user knows which.

Don't advise cancelling bills. If the user pivots to "what can I cancel", the
subscription-audit skill is the focused tool for that.

## Boundaries

- If the ledger covers less than ~3 months, say the history is too short for a
  reliable overview instead of guessing. Annual payments need more than a year
  of history — say so when the ledger is younger than that.
- This is a report, not a change to the user's finances — never remove or edit
  journal entries as part of this overview.
