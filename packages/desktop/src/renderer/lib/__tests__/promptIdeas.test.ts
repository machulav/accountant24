import { describe, expect, it } from "vitest";
import {
  dealPromptIdeas,
  GETTING_STARTED_MAX_TRANSACTIONS,
  PROMPT_IDEA_GROUPS,
  PROMPT_IDEAS_SHOWN,
  type PromptIdeaDecks,
} from "../promptIdeas";

// dealPromptIdeas deals one New Chat visit's ideas from the stored decks.
// `random` is injected so the expected ids can be hardcoded: a constant 0
// shuffles into declaration order, a value just under 1 into reverse.

const ids = (ideas: { id: string }[]) => ideas.map((idea) => idea.id);
const first = () => 0;
const last = () => 0.999;
const groupOf = (id: string) => PROMPT_IDEA_GROUPS.find((g) => g.ideas.some((i) => i.id === id))?.id;
const groupIds = (id: string) => ids(PROMPT_IDEA_GROUPS.filter((g) => g.id === id).flatMap((g) => g.ideas));
const gettingStartedIds = groupIds("getting-started");

/** `visits` consecutive deals, threading the decks through like the page does. */
function visitTimes(visits: number, transactionCount: number, random: () => number, decks: PromptIdeaDecks = {}) {
  const hands: string[][] = [];
  let current = decks;
  for (let i = 0; i < visits; i++) {
    const deal = dealPromptIdeas(transactionCount, current, random);
    hands.push(ids(deal.ideas));
    current = deal.decks;
  }
  return { hands, decks: current };
}

describe("dealPromptIdeas()", () => {
  describe("while the ledger has up to 10 transactions", () => {
    it("should deal the first five Getting started ideas from fresh decks when random is 0 and the ledger is empty", () => {
      const { ideas, decks } = dealPromptIdeas(0, {}, first);
      expect(ids(ideas)).toEqual([
        "import-bank-statement",
        "record-spending",
        "add-from-receipt",
        "set-up-accounts",
        "add-bank-account",
      ]);
      expect(decks).toEqual({
        "getting-started": [
          "set-main-currency",
          "what-can-you-do",
          "remember-my-name",
          "get-to-know-me",
          "what-first",
          "starting-balances",
          "record-income",
          "add-credit-card",
          "show-net-worth",
        ],
      });
    });

    it("should still deal Getting started ideas at exactly 10 transactions", () => {
      expect(ids(dealPromptIdeas(10, {}, first).ideas)).toEqual([
        "import-bank-statement",
        "record-spending",
        "add-from-receipt",
        "set-up-accounts",
        "add-bank-account",
      ]);
    });

    it("should shuffle into reverse order when random is close to 1", () => {
      expect(ids(dealPromptIdeas(0, {}, last).ideas)).toEqual([
        "show-net-worth",
        "add-credit-card",
        "record-income",
        "starting-balances",
        "what-first",
      ]);
    });

    it("should deal the rest of the deck first, then reshuffle for the remainder of the hand", () => {
      const { ideas, decks } = dealPromptIdeas(
        0,
        { "getting-started": ["set-main-currency", "what-can-you-do"] },
        first,
      );
      expect(ids(ideas)).toEqual([
        "set-main-currency",
        "what-can-you-do",
        "import-bank-statement",
        "record-spending",
        "add-from-receipt",
      ]);
      expect(decks["getting-started"]).toEqual([
        "set-up-accounts",
        "add-bank-account",
        "set-main-currency",
        "what-can-you-do",
        "remember-my-name",
        "get-to-know-me",
        "what-first",
        "starting-balances",
        "record-income",
        "add-credit-card",
        "show-net-worth",
      ]);
    });

    it("should move an id the reshuffle repeats from this hand to the deck's end instead of dealing it twice", () => {
      // The reversed reshuffle starts with show-net-worth, just dealt from
      // the old deck.
      const { ideas, decks } = dealPromptIdeas(0, { "getting-started": ["show-net-worth"] }, last);
      expect(ids(ideas)).toEqual([
        "show-net-worth",
        "add-credit-card",
        "record-income",
        "starting-balances",
        "what-first",
      ]);
      expect(decks["getting-started"]).toEqual([
        "get-to-know-me",
        "remember-my-name",
        "what-can-you-do",
        "set-main-currency",
        "add-bank-account",
        "set-up-accounts",
        "add-from-receipt",
        "record-spending",
        "import-bank-statement",
        "show-net-worth",
      ]);
    });

    it("should skip stored ids that are no longer in the list and duplicates", () => {
      const { ideas, decks } = dealPromptIdeas(
        0,
        { "getting-started": ["gone-idea", "record-spending", "record-spending"] },
        first,
      );
      expect(ids(ideas)).toEqual([
        "record-spending",
        "import-bank-statement",
        "add-from-receipt",
        "set-up-accounts",
        "add-bank-account",
      ]);
      expect(decks["getting-started"]).toEqual([
        "set-main-currency",
        "what-can-you-do",
        "remember-my-name",
        "get-to-know-me",
        "what-first",
        "starting-balances",
        "record-income",
        "add-credit-card",
        "show-net-worth",
        "record-spending",
      ]);
    });

    it("should show every Getting started idea within three visits with the default random source", () => {
      const { hands } = visitTimes(3, 0, Math.random);
      expect(hands[0]).toHaveLength(PROMPT_IDEAS_SHOWN);
      expect(new Set(hands.flat())).toEqual(new Set(gettingStartedIds));
    });

    it("should leave the other groups' decks untouched", () => {
      const { decks } = dealPromptIdeas(0, { ask: ["top-payees"], history: [] }, first);
      expect(decks.ask).toEqual(["top-payees"]);
      expect(decks.history).toEqual([]);
    });
  });

  describe("once the ledger has more than 10 transactions", () => {
    it("should deal the first idea of each other group, in group order, from fresh decks when random is 0", () => {
      const { ideas, decks } = dealPromptIdeas(GETTING_STARTED_MAX_TRANSACTIONS + 1, {}, first);
      expect(ids(ideas)).toEqual([
        "last-transactions",
        "record-refund",
        "monthly-budget",
        "changes-today",
        "monthly-payments",
      ]);
      expect(decks.history).toEqual([
        "undo-last-change",
        "transaction-history",
        "undo-last-import",
        "restore-deleted",
        "changes-this-week",
      ]);
      expect(decks.skills).toEqual([
        "cancel-subscriptions",
        "create-review-skill",
        "list-skills",
        "skills-to-add",
        "subscription-increases",
        "what-else-can-you-do",
      ]);
      expect(decks.ask).toHaveLength(18);
      expect(decks["getting-started"]).toBeUndefined();
    });

    it("should deal the last idea of each other group when random is close to 1", () => {
      expect(ids(dealPromptIdeas(5000, {}, last).ideas)).toEqual([
        "balances-by-currency",
        "add-another-account",
        "know-me-better",
        "changes-this-week",
        "what-else-can-you-do",
      ]);
    });

    it("should continue each group's deck on the next visit", () => {
      const { hands } = visitTimes(2, 11, first);
      expect(hands[1]).toEqual([
        "spent-this-month",
        "record-transfer",
        "recurring-bills",
        "undo-last-change",
        "cancel-subscriptions",
      ]);
    });

    it("should show every idea of a group once per deck, reshuffling when the deck runs out", () => {
      const visits = groupIds("ask").length;
      const { hands } = visitTimes(visits, 11, Math.random);
      const shown = hands.flat();
      // Ask is the largest group: exactly one full deck over these visits.
      for (const id of groupIds("ask")) expect(shown.filter((s) => s === id)).toHaveLength(1);
      // Every other group cycles its deck several times; no idea is ever
      // more than one showing ahead of another.
      for (const group of PROMPT_IDEA_GROUPS.slice(2)) {
        const size = group.ideas.length;
        for (const idea of group.ideas) {
          const times = shown.filter((s) => s === idea.id).length;
          expect(times).toBeGreaterThanOrEqual(Math.floor(visits / size));
          expect(times).toBeLessThanOrEqual(Math.ceil(visits / size));
        }
      }
    });

    it("should never include a Getting started idea", () => {
      for (const id of ids(dealPromptIdeas(11, {}).ideas)) expect(gettingStartedIds).not.toContain(id);
    });

    it("should deal one idea per other group, in group order, with the default random source", () => {
      const picked = ids(dealPromptIdeas(11, {}).ideas);
      expect(picked).toHaveLength(PROMPT_IDEAS_SHOWN);
      expect(picked.map(groupOf)).toEqual(["ask", "log-and-edit", "rules", "history", "skills"]);
    });
  });
});

describe("PROMPT_IDEA_GROUPS", () => {
  const all = PROMPT_IDEA_GROUPS.flatMap((g) => g.ideas);

  it("should hold the six groups in display order", () => {
    expect(PROMPT_IDEA_GROUPS.map((g) => g.id)).toEqual([
      "getting-started",
      "ask",
      "log-and-edit",
      "rules",
      "history",
      "skills",
    ]);
  });

  it("should hold more Getting started ideas than a visit shows, so visits differ", () => {
    expect(gettingStartedIds.length).toBeGreaterThan(PROMPT_IDEAS_SHOWN);
  });

  it("should hold exactly as many other groups as a visit shows ideas, one each", () => {
    expect(PROMPT_IDEA_GROUPS.length - 1).toBe(PROMPT_IDEAS_SHOWN);
  });

  it("should hold at least one idea in every group", () => {
    for (const group of PROMPT_IDEA_GROUPS) expect(group.ideas.length).toBeGreaterThan(0);
  });

  it("should use ids that are unique across all groups", () => {
    expect(new Set(ids(all)).size).toBe(all.length);
  });

  it("should use kebab-case ids", () => {
    for (const idea of all) expect(idea.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("should keep every prompt a single non-empty line", () => {
    for (const idea of all) {
      expect(idea.prompt.trim()).not.toBe("");
      expect(idea.prompt).not.toMatch(/\n/);
    }
  });

  it("should keep the copy rules: no em dashes, no ellipsis, accounts never categories", () => {
    for (const idea of all) {
      expect(idea.prompt).not.toMatch(/—/);
      expect(idea.prompt).not.toMatch(/…|\.\.\./);
      expect(idea.prompt).not.toMatch(/categor/i);
    }
  });
});
