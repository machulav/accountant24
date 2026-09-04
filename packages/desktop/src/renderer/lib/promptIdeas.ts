// The prompt ideas shown under the composer on the New Chat page: one
// hardcoded list in groups, five dealt per visit from shuffled decks so every
// idea comes around once before any repeats. Written as the user would type
// them: one line, short, generic (no amounts, no real payee or account
// names, "account" never "category"), no ellipsis, no em dashes. The ids are
// what analytics carries, never the text, so wording can change freely while
// an id stays put.

export interface PromptIdea {
  id: string;
  prompt: string;
}

export interface PromptIdeaGroup {
  id: "getting-started" | "ask" | "log-and-edit" | "rules" | "history" | "skills";
  ideas: PromptIdea[];
}

/** Ledgers with at most this many transactions get the Getting started ideas. */
export const GETTING_STARTED_MAX_TRANSACTIONS = 10;

/** How many ideas a visit shows: also the number of groups the explore set
 *  draws from, one idea each. */
export const PROMPT_IDEAS_SHOWN = 5;

export const PROMPT_IDEA_GROUPS: readonly PromptIdeaGroup[] = [
  {
    id: "getting-started",
    ideas: [
      { id: "import-bank-statement", prompt: "Import my bank statement" },
      { id: "record-spending", prompt: "Record spending" },
      { id: "add-from-receipt", prompt: "Add transactions from a receipt" },
      { id: "set-up-accounts", prompt: "Set up my accounts" },
      { id: "add-bank-account", prompt: "Add a bank account" },
      { id: "set-main-currency", prompt: "Set my main currency" },
      { id: "what-can-you-do", prompt: "What can you do?" },
      { id: "remember-my-name", prompt: "Remember my name" },
      { id: "get-to-know-me", prompt: "Ask me a few questions to get to know me" },
      { id: "what-first", prompt: "What should I do first?" },
      { id: "starting-balances", prompt: "Set my starting balances" },
      { id: "record-income", prompt: "Record my income" },
      { id: "add-credit-card", prompt: "Add a credit card" },
      { id: "show-net-worth", prompt: "Show my net worth" },
    ],
  },
  {
    id: "ask",
    ideas: [
      { id: "last-transactions", prompt: "Show my last transactions" },
      { id: "spent-this-month", prompt: "How much did I spend this month?" },
      { id: "where-money-went", prompt: "Where did most of my money go last month?" },
      { id: "compare-months", prompt: "Compare this month's spending to last month" },
      { id: "spending-by-month", prompt: "Show my spending for the year by month" },
      { id: "net-worth-trend", prompt: "Show my net worth over the last months" },
      { id: "total-across-accounts", prompt: "How much do I have across all my accounts?" },
      { id: "earned-vs-spent", prompt: "How much did I earn vs spend this year?" },
      { id: "income-this-year", prompt: "Show my income for this year" },
      { id: "monthly-savings", prompt: "How much am I saving each month?" },
      { id: "top-payees", prompt: "Which payees do I spend the most with?" },
      { id: "biggest-purchase", prompt: "What was my biggest purchase this year?" },
      { id: "last-trip-cost", prompt: "How much did my last trip cost?" },
      { id: "hobby-spending", prompt: "Show everything I spent on a hobby" },
      { id: "upcoming-30-days", prompt: "What is coming up in the next 30 days?" },
      { id: "within-budget", prompt: "Am I within my budget this month?" },
      { id: "credit-card-balance", prompt: "How much do I owe on my credit card?" },
      { id: "find-receipt", prompt: "Show me the receipt for a purchase" },
      { id: "balances-by-currency", prompt: "How much do I have in each currency?" },
    ],
  },
  {
    id: "log-and-edit",
    ideas: [
      { id: "record-refund", prompt: "Record a refund" },
      { id: "record-transfer", prompt: "Record a transfer between my accounts" },
      { id: "split-transaction", prompt: "Split my last transaction between two accounts" },
      { id: "add-note", prompt: "Add a note to a transaction" },
      { id: "tag-last-trip", prompt: "Tag transactions from my last trip" },
      { id: "merge-payees", prompt: "Merge two payees that are the same business" },
      { id: "rename-account", prompt: "Rename an account" },
      { id: "check-duplicates", prompt: "Check my ledger for duplicates and mistakes" },
      { id: "find-unusual", prompt: "Find transactions that look unusual" },
      { id: "reconcile-balance", prompt: "Reconcile my current balance" },
      { id: "import-latest-statement", prompt: "Import my latest bank statement" },
      { id: "record-todays-spending", prompt: "Record today's spending" },
      { id: "correct-last-transaction", prompt: "Correct my last transaction" },
      { id: "delete-transaction", prompt: "Delete a transaction I added by mistake" },
      { id: "move-transaction", prompt: "Move a transaction to a different account" },
      { id: "attach-receipt", prompt: "Attach a receipt to a transaction" },
      { id: "update-investment-values", prompt: "Update the value of my investments" },
      { id: "purchase-from-receipt", prompt: "Add a purchase from a receipt" },
      { id: "record-received-income", prompt: "Record income I received" },
      { id: "add-another-account", prompt: "Add another account" },
    ],
  },
  {
    id: "rules",
    ideas: [
      { id: "monthly-budget", prompt: "Set a monthly budget and warn me when I get close" },
      { id: "recurring-bills", prompt: "Set up my recurring bills" },
      { id: "monthly-salary", prompt: "Set up my monthly salary" },
      { id: "household-split", prompt: "Set up my household and who pays for what" },
      { id: "tag-upcoming-trip", prompt: "Tag everything from my upcoming trip" },
      { id: "import-reminder", prompt: "Remind me to import my bank statement every month" },
      { id: "what-you-remember", prompt: "What do you remember about me?" },
      { id: "answer-language", prompt: "Talk to me in my language" },
      { id: "flag-unusual-on-import", prompt: "Warn me about unusual transactions when I import" },
      { id: "know-me-better", prompt: "Ask me a few questions to know me better" },
    ],
  },
  {
    id: "history",
    ideas: [
      { id: "changes-today", prompt: "What did you change today?" },
      { id: "undo-last-change", prompt: "Undo the last change" },
      { id: "transaction-history", prompt: "Show the history of one transaction" },
      { id: "undo-last-import", prompt: "Undo everything from my last import" },
      { id: "restore-deleted", prompt: "Restore a transaction I deleted" },
      { id: "changes-this-week", prompt: "What changed this week?" },
    ],
  },
  {
    id: "skills",
    ideas: [
      { id: "monthly-payments", prompt: "What am I paying every month?" },
      { id: "cancel-subscriptions", prompt: "Which subscriptions can I cancel?" },
      { id: "create-review-skill", prompt: "Create a skill" },
      { id: "list-skills", prompt: "What skills do I have and what can I do with them?" },
      { id: "skills-to-add", prompt: "How can I get more skills?" },
      { id: "subscription-increases", prompt: "Check my subscriptions for price increases" },
      { id: "what-else-can-you-do", prompt: "What else can you do?" },
    ],
  },
];

/** What is left to deal per group, as idea ids in deal order. A missing or
 *  empty deck reshuffles the group; ids no longer in the list are skipped, so
 *  a stored deck survives copy changes. */
export type PromptIdeaDecks = Partial<Record<PromptIdeaGroup["id"], string[]>>;

/** One visit's hand and the decks to store for the next one. */
export interface PromptIdeaDeal {
  ideas: PromptIdea[];
  decks: PromptIdeaDecks;
}

/** The ideas in a fresh random order, each position by one `random()` draw
 *  over what is left, so a constant `random` yields the list's own order. */
function shuffle(ideas: readonly PromptIdea[], random: () => number): string[] {
  const pool = [...ideas];
  return Array.from({ length: pool.length })
    .flatMap(() => pool.splice(Math.floor(random() * pool.length), 1))
    .map((idea) => idea.id);
}

/** Deal `count` ideas from the top of the group's deck, reshuffling the group
 *  when the deck runs out. An id the new deck repeats from this very hand
 *  moves to the deck's end, so each idea still shows once per deck. */
function deal(
  ideas: readonly PromptIdea[],
  count: number,
  deck: readonly string[] | undefined,
  random: () => number,
): { ideas: PromptIdea[]; deck: string[] } {
  const known = new Set(ideas.map((idea) => idea.id));
  let remaining = [...new Set(deck)].filter((id) => known.has(id));
  const dealt: string[] = [];
  while (dealt.length < Math.min(count, ideas.length)) {
    if (remaining.length === 0) remaining = shuffle(ideas, random);
    // Non-empty here: a reshuffle has more ids than this hand still needs.
    const next = remaining.shift() as string;
    if (dealt.includes(next)) remaining.push(next);
    else dealt.push(next);
  }
  return { ideas: dealt.flatMap((id) => ideas.filter((idea) => idea.id === id)), deck: remaining };
}

/** The ideas for one New Chat visit, dealt from `decks` (the stored state
 *  from the last visit; `{}` on the first). A ledger with up to
 *  GETTING_STARTED_MAX_TRANSACTIONS transactions gets PROMPT_IDEAS_SHOWN
 *  Getting started ideas; a bigger one gets one idea from each other group,
 *  in group order, so the set stays diverse. Decks of groups not dealt from
 *  are carried over untouched. `random` is injectable for deterministic tests. */
export function dealPromptIdeas(
  transactionCount: number,
  decks: PromptIdeaDecks,
  random: () => number = Math.random,
): PromptIdeaDeal {
  const groups =
    transactionCount <= GETTING_STARTED_MAX_TRANSACTIONS
      ? PROMPT_IDEA_GROUPS.filter((group) => group.id === "getting-started")
      : PROMPT_IDEA_GROUPS.filter((group) => group.id !== "getting-started");
  const count = groups.length === 1 ? PROMPT_IDEAS_SHOWN : 1;
  const next: PromptIdeaDecks = { ...decks };
  const ideas = groups.flatMap((group) => {
    const hand = deal(group.ideas, count, decks[group.id], random);
    next[group.id] = hand.deck;
    return hand.ideas;
  });
  return { ideas, decks: next };
}
