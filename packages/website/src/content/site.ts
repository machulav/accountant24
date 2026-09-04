// All copy and data for the landing page in one place. Wording follows the
// README and docs; keep it to shipped features and product vocabulary.
import { PROMPT_IDEA_GROUPS } from "../../../desktop/src/renderer/lib/promptIdeas";
import { buildPageChats } from "../lib/page-chats";

export const site = {
  name: "Accountant24",
  url: "https://accountant24.ai",
  title: "Open source AI agent for personal finance | Accountant24",
  description:
    "Accountant24 is an open source AI agent for personal finance. Log spending in plain language, import bank statements, CSV exports and receipts, ask questions about your money. Your data stays on your machine as plain text files, versioned with git.",
  headline: "Open source AI agent for personal finance",
  tagline: "Runs on your machine, you own the data",
  supporting:
    "Log spending, import bank statements and receipts, ask questions about your money. Works with any LLM, including local ones.",
  github: "https://github.com/machulav/accountant24",
  downloadUrl: "https://github.com/machulav/accountant24/releases/latest/download/Accountant24.dmg",
  releasesUrl: "https://github.com/machulav/accountant24/releases",
  docsUrl: "/docs",
  quickstartUrl: "/docs/quickstart",
  // PostHog project token (EU cloud). A client-side token meant to be public,
  // like the Aptabase key in the desktop app. Empty disables analytics.
  posthogKey: "",
} as const;

export interface DemoChip {
  kind: "account" | "payee" | "tag" | "skill";
  label: string;
}

// A scripted demo scene the app mock plays (the hero window on a loop, the
// features mock per feature). Fields are optional so a scene can be
// chat-shaped (user, working, reply) or composer-shaped (an open model menu).
// Keep tables at three or fewer columns and four or fewer rows, and bullet
// lists at three or fewer items, so they fit the mock's narrow thread. A blank
// line ("\n\n") in a reply text starts a new paragraph, and a mention like
// `:payee[Trader Joe's]` or `:account[Expenses:Groceries]` renders as an
// inline chip, as in the app.
export interface SceneDemo {
  user?: { text: string; attachments?: { name: string; meta: string }[] };
  working?: { steps: string[]; duration: string };
  reply?: { text: string; bullets?: string[]; chips?: DemoChip[]; table?: { head: string[]; rows: string[][] } };
  composer?: { models?: { name: string; note?: string }[] };
}

export interface FeatureDemo extends SceneDemo {
  /** Shown as this scene's chat in the mock sidebar. */
  chatTitle: string;
}

// The conversation the hero window plays on a loop: one thread of up to two
// turns, listed in the mock sidebars under its chat title.
export interface HeroDemo {
  chatTitle: string;
  turns: SceneDemo[];
}

export interface Feature {
  title: string;
  description: string;
  link?: { label: string; href: string };
  demo: FeatureDemo;
}

// Every prompt idea the app deals under its composer, read straight from the
// app's list so the page and the app always share one wording.
export const promptIdeas: string[] = PROMPT_IDEA_GROUPS.flatMap((group) => group.ideas.map((idea) => idea.prompt));

export const features: Feature[] = [
  {
    title: "Natural language entry",
    description:
      "A plain sentence becomes a proper double-entry transaction in your ledger. The agent fills in the details.",
    demo: {
      chatTitle: "Groceries at Trader Joe's",
      user: { text: "I paid $42.50 cash for groceries at Trader Joe's yesterday" },
      working: { steps: ["Add Transactions", "Commit"], duration: "3s" },
      reply: {
        text: "Recorded. $42.50 at :payee[Trader Joe's] went to :account[Expenses:Groceries], paid from :account[Assets:Cash].",
      },
    },
  },
  {
    title: "Statement and receipt import",
    description:
      "A PDF bank statement, a CSV export, an invoice, or a photo of a paper receipt becomes transactions in your ledger. The original file is archived in your workspace and attached to the transactions.",
    demo: {
      chatTitle: "August statement import",
      user: { text: "Import this statement", attachments: [{ name: "statement-aug.pdf", meta: "PDF · 245 KB" }] },
      working: { steps: ["Extract Text", "Add Transactions", "Commit"], duration: "9s" },
      reply: {
        text: "Done. I added 23 transactions from your August statement.",
      },
    },
  },
  {
    title: "Corrections that stick",
    description:
      "Correct a category once, or mention a budget or a habit, and the agent remembers it and applies it whenever it matters.",
    link: { label: "How memory works", href: "/docs/memory" },
    demo: {
      chatTitle: "Costco is groceries",
      user: { text: "Costco is groceries, not shopping" },
      working: { steps: ["Bulk Edit Transactions", "Update Memory", "Commit"], duration: "5s" },
      reply: {
        text: "Moved 6 Costco transactions to groceries and noted the rule, so future Costco receipts go there too:",
        chips: [
          { kind: "payee", label: "Costco" },
          { kind: "account", label: "Expenses:Groceries" },
        ],
      },
    },
  },
  {
    title: "Answers about your money",
    description:
      "The agent reads your ledger and answers clearly, from what a trip cost to how your net worth is doing. @ points it at a specific account, payee, or tag.",
    demo: {
      chatTitle: "Last month spending",
      user: { text: "Where did my money go last month?" },
      working: { steps: ["Query Ledger"], duration: "4s" },
      reply: {
        text: "Most of it went to rent and groceries:",
        table: {
          head: ["Account", "August"],
          rows: [
            ["Rent", "$1,850.00"],
            ["Groceries", "$612.30"],
            ["Restaurants", "$285.90"],
            ["Gas", "$184.50"],
          ],
        },
      },
    },
  },
  {
    title: "Plugin marketplace",
    description:
      "Extend the agent with new capabilities. Install plugins other people have built from the marketplace, like a subscription audit, or describe a routine, like a monthly review, and the agent builds a plugin for you.",
    link: { label: "Browse the marketplace", href: "/docs/marketplace" },
    demo: {
      chatTitle: "Subscription audit",
      user: { text: "Audit my subscriptions" },
      working: { steps: ["Use Skill: skills:subscription-audit", "Query Ledger"], duration: "10s" },
      reply: {
        text: "You pay for 9 subscriptions, $112 a month. Two have had no use logged since May:",
        table: {
          head: ["Subscription", "Monthly"],
          rows: [
            ["Hulu", "$17.99"],
            ["Peloton App", "$12.99"],
          ],
        },
      },
    },
  },
  {
    title: "Any LLM, fully local if you want",
    description:
      "Sign in with your ChatGPT or Claude subscription, or use an API key from Anthropic, OpenAI, Google, and more. Or run a local model with Ollama, and nothing ever leaves your machine.",
    link: { label: "Go fully local", href: "/docs/go-fully-local" },
    demo: {
      chatTitle: "New chat",
      composer: {
        models: [
          { name: "Opus 5", note: "Anthropic" },
          { name: "GPT-5", note: "OpenAI" },
          { name: "Llama 3", note: "Ollama (local)" },
        ],
      },
    },
  },
  {
    title: "Full change history, easy undo",
    description:
      "Every change is recorded automatically. Review what happened anytime, roll back a mistake, or keep a private backup. Under the hood it's a local git repo, the same system developers trust with their code.",
    demo: {
      chatTitle: "Undo last change",
      user: { text: "Undo my last change" },
      working: { steps: ["Query Ledger", "Commit"], duration: "3s" },
      reply: { text: "Reverted. Your ledger is back to how it was, and the history keeps a record of both changes." },
    },
  },
];

export const heroDemo: HeroDemo = {
  chatTitle: "August statements",
  turns: [
    {
      user: {
        text: "Import my August statements",
        attachments: [
          { name: "chase-aug.pdf", meta: "PDF · 312 KB" },
          { name: "amex-aug.csv", meta: "CSV · 41 KB" },
          { name: "fidelity-aug.pdf", meta: "PDF · 188 KB" },
        ],
      },
      working: {
        steps: ["Extract Text", "Add Transactions", "Add Balance Assertions", "Add Prices", "Commit"],
        duration: "14s",
      },
      reply: {
        text: "Imported 61 transactions from three statements. Balances match, and your Fidelity investments are up to date as of August 31.\n\nThree things I noticed:",
        bullets: [
          "Your $412 Delta refund came through. I linked it to the original transaction, as you asked.",
          "Netflix charged $17.99, up from $15.49 last month.",
          "I don't see August rent in these statements. You usually pay it by the end of the month.",
        ],
      },
    },
    {
      user: { text: "What's my net worth now?" },
      working: { steps: ["Query Ledger"], duration: "3s" },
      reply: {
        text: "$84,310, up $1,240 since July. Investments gained $1,620, cash and cards slipped a little:",
        table: {
          head: ["Account", "Balance", "Change"],
          rows: [
            ["Cash", "$12,450", "-$310"],
            ["Investments", "$73,600", "+$1,620"],
            ["Credit cards", "-$1,740", "-$70"],
          ],
        },
      },
    },
  ],
};

// Every chat on the page, as the mock windows list them in their sidebar:
// the hero conversation, then one chat per feature.
export const pageChats = buildPageChats(
  heroDemo.chatTitle,
  features.map((feature) => feature.demo.chatTitle),
);
