// All copy and data for the landing page in one place. Wording follows the
// README and docs; keep it to shipped features and product vocabulary. The
// demo scenes each card plays live in @accountant24/demo.
import { augustStatements } from "@accountant24/demo/scenes/august-statements";
import { groceries } from "@accountant24/demo/scenes/groceries";
import { londonTrip } from "@accountant24/demo/scenes/london-trip";
import { modelMenu } from "@accountant24/demo/scenes/model-menu";
import { statementImport } from "@accountant24/demo/scenes/statement-import";
import { subscriptionAudit } from "@accountant24/demo/scenes/subscription-audit";
import { tripCost } from "@accountant24/demo/scenes/trip-cost";
import { undo } from "@accountant24/demo/scenes/undo";
import type { FeatureDemo } from "@accountant24/demo/shared/types";
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

export interface Feature {
  title: string;
  description: string;
  link?: { label: string; href: string };
  demo: FeatureDemo;
}

// Every prompt idea the app deals under its composer, read straight from the
// app's list so the page and the app always share one wording.
export const promptIdeas: string[] = PROMPT_IDEA_GROUPS.flatMap((group) => group.ideas.map((idea) => idea.prompt));

/** A feature worth naming, without a demo of its own. */
export interface Extra {
  title: string;
  description: string;
}

// Shown as a plain grid under the demos: what the app is, next to what it does.
export const extras: Extra[] = [
  {
    title: "Double-entry bookkeeping",
    description:
      "The method accountants use. One thing you notice right away: moving money between your own accounts never counts as spending.",
  },
  {
    title: "Multi-currency support",
    description:
      "Hold as many currencies as you need. Each account keeps its own, and your net worth is converted into your main currency.",
  },
  {
    title: "Investment tracking",
    description:
      "Stocks, funds, and crypto get their own accounts, holding the units you actually own, right next to your cash and debts. Tell the agent today's price and your net worth is the whole picture.",
  },
  {
    title: "Works offline",
    description: "Run a local model with Ollama and the whole app keeps working with no internet at all.",
  },
  {
    title: "Your data stays yours",
    description:
      "Everything lives in plain text files in one folder on your machine. No cloud, no account, no lock-in.",
  },
  {
    title: "Built on a coding agent",
    description:
      "Your books are plain text files, and careful work with files is exactly what a coding agent is good at.",
  },
];

export const features: Feature[] = [
  {
    title: "Natural language entry",
    description:
      "A plain sentence becomes a proper double-entry transaction in your ledger. The agent fills in the details.",
    demo: groceries,
  },
  {
    title: "Statement and receipt import",
    description:
      "A PDF bank statement, a CSV export, an invoice, or a photo of a paper receipt becomes transactions in your ledger. The original file is archived in your workspace and attached to the transactions.",
    demo: statementImport,
  },
  {
    title: "Memory across chats",
    description:
      "Mention a trip, a budget, or a habit once. The agent remembers it across chats and applies it when it matters.",
    link: { label: "How memory works", href: "/docs/memory" },
    demo: londonTrip,
  },
  {
    title: "Answers about your money",
    description:
      "Ask in plain words and get a straight answer from your own numbers, whether it's one trip, one payee, or the whole year. Type @ to point the question at an account, a payee, or a tag.",
    demo: tripCost,
  },
  {
    title: "Plugins",
    description:
      "Plugins give the agent new skills. Install one from the marketplace, or describe a routine and the agent builds a plugin for it, ready to reuse whenever you need it.",
    demo: subscriptionAudit,
  },
  {
    title: "Any LLM, fully local if you want",
    description:
      "Sign in with your ChatGPT or Claude subscription, or use an API key from Anthropic, OpenAI, Google, and more. Or run a local model with Ollama, and nothing ever leaves your machine.",
    demo: modelMenu,
  },
  {
    title: "Full change history, easy undo",
    description:
      "Every change is recorded automatically. Review what happened anytime, roll back a mistake, or keep a private backup. Under the hood it's a local git repo, the same system developers trust with their code.",
    demo: undo,
  },
];

/** The conversation the hero window plays on a loop. */
export const heroDemo = augustStatements;

// Every chat on the page, as the mock windows list them in their sidebar:
// the hero conversation, then one chat per feature.
export const pageChats = buildPageChats(
  heroDemo.chatTitle,
  features.map((feature) => feature.demo.chatTitle),
);
