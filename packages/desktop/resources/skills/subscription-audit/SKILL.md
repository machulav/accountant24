---
name: subscription-audit
description: Reviews your subscriptions and memberships, like streaming, apps, SaaS, gym, and news services. Shows what each costs per month and per year, when it renews, and flags price increases, duplicate services, forgotten charges, and subscriptions you likely cancelled. Ask things like "list my subscriptions", "what can I cancel", "when does Netflix renew", or "did Spotify get more expensive". For rent, utilities, and the full recurring picture, use the recurring-spending skill.
---

# Subscription Audit

Find the user's cancellable services in the ledger — streaming, software,
memberships — present them as one overview, and flag what deserves attention.
This is a read-only analysis: use the `query` tool only — never modify the
journal in this workflow.

## Detecting recurring charges

<!-- Duplicated in the recurring-spending skill (minus the variable-amount
     relaxation there). Keep the two sections in sync. -->

1. Pull the last 13 months of expense postings in machine-readable form with
   the `query` tool: `report: "reg"`, `account_pattern: "Expenses"`,
   `begin_date: <13 months ago>`, `output_format: "csv"`. 13 months, not 12,
   so an annual renewal appears twice. For large ledgers, narrow with
   `payee_pattern` on follow-up queries instead of re-pulling.
2. Group postings by payee. A payee is a recurring-charge candidate when all
   hold:
   - it appears in **3 or more distinct months** (or twice, ~1 year apart, for
     annual plans), and
   - the interval between charges is regular — monthly ±4 days, weekly ±1 day,
     quarterly ±1 week, yearly ±2 weeks, and
   - the amounts are identical or step between two stable values (a step is a
     price change, not a disqualifier — record it).
3. Regularity beats frequency: payees with irregular gaps or widely varying
   amounts (groceries, restaurants, fuel) are never subscriptions, no matter
   how often they appear.
4. One payee can hide both a subscription and ordinary shopping (Amazon orders
   vs Prime, an Apple device vs Apple Music). Isolate the fixed-amount regular
   series and judge it alone — never flag a payee wholesale.
5. Payee spelling drifts ("Netflix" vs "NETFLIX.COM" vs "Netflix.com
   Amsterdam") — normalize case and punctuation when grouping, and say which
   payees you merged so the user can correct you.

## Keeping only subscriptions

This skill covers services the user could cancel today, with no penalty, and
keep functioning:

- **In**: streaming and music, software and SaaS, apps, cloud storage, news
  and magazines, gym and other memberships, recurring donations.
- **Out**: rent or mortgage, utilities, insurance, loan payments, taxes, phone
  plans, internet, childcare. These are obligations, not subscriptions — leave
  them out of this report entirely.

If the user's question is really about total monthly costs or bills, use the
recurring-spending skill instead of stretching this one.

## Reporting

Present a single table sorted by monthly-equivalent cost:

| Payee | Account | Cadence | Amount | ≈ Monthly | Last charged | Next expected | Notes |

- **Payee** = the normalized payee name from the journal (spelling variants
  merged).
- **Account** = the expense account the charge posts to, as the full account
  name (e.g. `Expenses:Entertainment`).
- **Notes** = short flags like "uncertain match" or "merged from 3 spellings";
  leave the cell empty when there's nothing to note.
- **Next expected** = last charge date + cadence. Flag anything more than one
  full cadence overdue as *probably cancelled* — list it separately, don't
  count it in the totals.
- Below the table show the total **per month and per year** in the ledger's
  own currency — the yearly figure is what makes people act. If several
  currencies appear, keep separate totals per currency; do not convert unless
  the user asks.
- When a detection is uncertain, show the evidence ("charged 12 times, same
  amount, about 30 days apart") so the user can judge it.

After the table, call out only what's noteworthy, in this order:

- **Price increases** — same service, higher amount between consecutive
  charges: show old → new, the percentage, and the per-year impact.
- **Possible duplicates** — overlapping services of the same kind (two music
  streaming payees, two cloud-storage payees).
- **Annual renewals coming up** within the next 60 days.
- **Recently started** — a recurring charge whose first occurrence is within
  the last ~2 months: mention it ("started five weeks ago") so a forgotten
  trial conversion doesn't slip by.

## Boundaries

- If the ledger covers less than ~3 months, say the history is too short for a
  reliable audit instead of guessing. Annual subscriptions need more than a
  year of history — say so when the ledger is younger than that.
- Cancellation is the user's action in the outside world — you can only
  report; never remove or edit journal entries as part of this audit.
