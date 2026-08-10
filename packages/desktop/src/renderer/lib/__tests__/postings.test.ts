import { describe, expect, it } from "vitest";
import { splitPostings } from "../postings";

// splitPostings decides what a collapsed register row leads with: the
// balance-sheet legs money left from (assets/liabilities, the real-world
// accounts), with the receiving and categorization legs (expenses, income,
// equity) hidden behind the expand.

const P = (account: string, quantity = 1) => ({ account, amounts: [{ quantity, commodity: "EUR", precision: 2 }] });

describe("splitPostings()", () => {
  it("should show the asset leg and hide the expense leg of a payment", () => {
    const postings = [P("expenses:food", 12.5), P("assets:cash", -12.5)];
    expect(splitPostings(postings)).toEqual({ shown: [P("assets:cash", -12.5)], hidden: [P("expenses:food", 12.5)] });
  });

  it("should show the liability leg and hide the expense leg of a card payment", () => {
    const postings = [P("expenses:leisure:books", 18), P("liabilities:card", -18)];
    expect(splitPostings(postings)).toEqual({
      shown: [P("liabilities:card", -18)],
      hidden: [P("expenses:leisure:books", 18)],
    });
  });

  it("should show only the source leg of a transfer between real accounts", () => {
    // Money is sent FROM the negative leg; the receiving leg folds, exactly
    // like the expense leg of a spending row.
    const postings = [P("assets:savings", 500), P("assets:checking", -500)];
    expect(splitPostings(postings)).toEqual({
      shown: [P("assets:checking", -500)],
      hidden: [P("assets:savings", 500)],
    });
  });

  it("should show every source leg when a payment is split across real accounts", () => {
    const postings = [P("expenses:food", 30), P("assets:cash", -10), P("liabilities:card", -20)];
    expect(splitPostings(postings)).toEqual({
      shown: [P("assets:cash", -10), P("liabilities:card", -20)],
      hidden: [P("expenses:food", 30)],
    });
  });

  it("should show all real legs when none of them flows out", () => {
    // A salary paid into two accounts: no real-account source to lead with.
    const postings = [P("assets:bank", 2000), P("assets:savings", 1000), P("income:salary", -3000)];
    expect(splitPostings(postings)).toEqual({
      shown: [P("assets:bank", 2000), P("assets:savings", 1000)],
      hidden: [P("income:salary", -3000)],
    });
  });

  it("should hide the income leg of a salary", () => {
    const postings = [P("assets:bank:checking", 3000), P("income:salary", -3000)];
    expect(splitPostings(postings)).toEqual({
      shown: [P("assets:bank:checking", 3000)],
      hidden: [P("income:salary", -3000)],
    });
  });

  it("should match top segments case-insensitively and in singular form", () => {
    const postings = [P("Assets:Bank", -1), P("Liability:Card", -1), P("Expenses:Food", 2)];
    expect(splitPostings(postings).shown).toEqual([P("Assets:Bank", -1), P("Liability:Card", -1)]);
  });

  it("should not match balance-sheet-like prefixes of other accounts", () => {
    // "assets-fund" is not the assets tree; a segment must match exactly.
    const postings = [P("assets-fund:x"), P("assets:real")];
    expect(splitPostings(postings).shown).toEqual([P("assets:real")]);
  });

  it("should show everything when no leg is a balance-sheet account", () => {
    const postings = [P("expenses:food"), P("equity:opening-balances")];
    expect(splitPostings(postings)).toEqual({ shown: postings, hidden: [] });
  });

  it("should treat a real leg without amounts as not flowing out", () => {
    // A malformed/empty-amount posting counts as zero: with the other real
    // leg flowing out, only that source leg leads.
    const postings = [{ account: "assets:bank", amounts: [] }, P("assets:cash", -5)];
    expect(splitPostings(postings)).toEqual({
      shown: [P("assets:cash", -5)],
      hidden: [{ account: "assets:bank", amounts: [] }],
    });
  });

  it("should return empty splits for no postings", () => {
    expect(splitPostings([])).toEqual({ shown: [], hidden: [] });
  });
});
