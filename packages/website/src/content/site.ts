// All copy and data for the landing page in one place. Wording follows the
// README and docs; keep it to shipped features and product vocabulary.
import { PROMPT_IDEA_GROUPS } from "../../../desktop/src/renderer/lib/promptIdeas";
import { buildPageChats } from "../lib/page-chats";

export const site = {
  name: "Accountant24",
  url: "https://accountant24.ai",
  title: "Open source AI agent for personal finance | Accountant24",
  description:
    "Accountant24 is an open source AI agent for personal finance. Log spending, import bank statements and receipts, ask questions about your money. Your data stays on your machine as plain text files, versioned with git.",
  headline: "Open source AI agent for personal finance",
  tagline: "Runs on your machine, you own the data",
  supporting:
    "Log spending, import bank statements and receipts, ask questions about your money. Your books are plain text files you own, versioned with git. Works with any LLM, including local ones.",
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
// Keep tables at three or fewer columns and four or fewer rows so they fit the
// mock's narrow thread.
export interface SceneDemo {
  user?: { text: string; attachment?: { name: string; meta: string } };
  working?: { steps: string[]; duration: string };
  reply?: { text: string; chips?: DemoChip[]; table?: { head: string[]; rows: string[][] } };
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
      user: { text: "I paid $42.50 for groceries at Trader Joe's yesterday" },
      working: { steps: ["Add Transactions", "Commit"], duration: "3s" },
      reply: {
        text: "Done. One transaction added to your ledger:",
        chips: [
          { kind: "payee", label: "Trader Joe's" },
          { kind: "account", label: "Expenses:Groceries" },
          { kind: "account", label: "Assets:Checking" },
        ],
      },
    },
  },
  {
    title: "Statement and receipt import",
    description:
      "A PDF bank statement, an invoice, or a photo of a paper receipt becomes transactions in your ledger. The original file is archived in your workspace and attached to the transactions.",
    demo: {
      chatTitle: "August statement import",
      user: { text: "Import this statement", attachment: { name: "statement-aug.pdf", meta: "PDF · 245 KB" } },
      working: { steps: ["Extract Text", "Add Transactions", "Commit"], duration: "9s" },
      reply: {
        text: "Imported 23 transactions from August. The original statement is archived in your workspace and attached to them.",
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
    title: "Persistent memory",
    description:
      "The agent remembers your rules, budgets, and habits from one mention, and applies them when it matters.",
    link: { label: "How memory works", href: "/docs/memory" },
    demo: {
      chatTitle: "Rent going up",
      user: { text: "Rent goes up to $1,950 from October" },
      working: { steps: ["Update Memory"], duration: "2s" },
      reply: { text: "Noted. From October I will expect rent at $1,950 and flag anything that does not match." },
    },
  },
  {
    title: "Plugin marketplace",
    description:
      "Extend the agent with new capabilities. Install plugins other people have built from the marketplace, or describe a routine, like a monthly review or a subscription audit, and the agent builds a plugin for you.",
    link: { label: "Browse the marketplace", href: "/docs/marketplace" },
    demo: {
      chatTitle: "Monthly review",
      user: { text: "Run my monthly review" },
      working: { steps: ["Use Skill: reviews:monthly-review", "Query Ledger"], duration: "12s" },
      reply: { text: "August looks healthy. Spending is down 8% from July, and your savings rate came in at 21%." },
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
  chatTitle: "Groceries at Whole Foods",
  turns: [
    {
      user: { text: "I spent $45 at Whole Foods yesterday" },
      working: { steps: ["Add Transactions", "Commit"], duration: "3s" },
      reply: {
        text: "Recorded. $45 from your checking account to groceries, dated yesterday:",
        chips: [
          { kind: "payee", label: "Whole Foods" },
          { kind: "account", label: "Expenses:Groceries" },
        ],
      },
    },
    {
      user: { text: "How much did I spend on food this month?" },
      working: { steps: ["Query Ledger"], duration: "4s" },
      reply: {
        text: "$312 so far in September, about a fifth under your usual pace:",
        table: {
          head: ["Account", "September"],
          rows: [
            ["Groceries", "$245.10"],
            ["Restaurants", "$66.90"],
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
