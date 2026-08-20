#!/usr/bin/env python3
"""Collapse an hledger `reg ... -O tsv` dump into a payee -> account map.

Usage: python3 map_payees.py <tsv_file>

Input columns (as emitted by hledger): txnidx, date, code, description,
account, amount, total. Payee is the description text before the first "|",
matching hledger's own payee/description split.

Prints one line per raw payee, tab-separated: payee, then "account (count)"
pairs sorted by count descending. Payees with more than one account are
prefixed with "MULTI" so they stand out when the model scans the output.

Deliberately does no spelling-variant grouping ("NETFLIX.COM" vs "Netflix"
stay separate rows) - judging which raw payee strings are the same
real-world merchant, and what to call the merged result, is the model's
call, not a heuristic here.
"""
import csv
import sys
from collections import Counter, defaultdict


def payee_of(description: str) -> str:
    return description.split("|", 1)[0].strip()


def main(path: str) -> None:
    counts: dict[str, Counter] = defaultdict(Counter)

    with open(path, newline="", encoding="utf-8") as f:
        # hledger's tsv is unquoted - a payee like `"Ye Olde" Shop` is written
        # literally, not csv-quoted. The default quotechar='"' dialect treats
        # a field starting with `"` as a quoted field and strips/merges it,
        # silently corrupting the payee string. Tabs/newlines can't appear in
        # hledger tsv fields, so QUOTE_NONE is safe and required here.
        reader = csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        for row in reader:
            payee = payee_of(row.get("description", ""))
            account = row.get("account", "").strip()
            if not payee or not account:
                continue
            counts[payee][account] += 1

    for payee in sorted(counts, key=str.casefold):
        accounts = counts[payee]
        ranked = sorted(accounts.items(), key=lambda kv: (-kv[1], kv[0]))
        accounts_str = ", ".join(f"{account} ({n})" for account, n in ranked)
        flag = "MULTI\t" if len(accounts) > 1 else "\t"
        print(f"{flag}{payee}\t{accounts_str}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: map_payees.py <tsv_file>", file=sys.stderr)
        sys.exit(1)
    main(sys.argv[1])
