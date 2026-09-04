// All copy and data for the landing page in one place. Wording follows the
// README and docs; keep it to shipped features and product vocabulary. The
// demo scenes each card plays live in @accountant24/demo.
import { augustStatements } from "@accountant24/demo/scenes/august-statements";
import { costcoRule } from "@accountant24/demo/scenes/costco-rule";
import { groceries } from "@accountant24/demo/scenes/groceries";
import { lastMonth } from "@accountant24/demo/scenes/last-month";
import { modelMenu } from "@accountant24/demo/scenes/model-menu";
import { statementImport } from "@accountant24/demo/scenes/statement-import";
import { subscriptionAudit } from "@accountant24/demo/scenes/subscription-audit";
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
    title: "Corrections that stick",
    description:
      "Correct a category once, or mention a budget or a habit, and the agent remembers it and applies it whenever it matters.",
    link: { label: "How memory works", href: "/docs/memory" },
    demo: costcoRule,
  },
  {
    title: "Answers about your money",
    description:
      "The agent reads your ledger and answers clearly, from what a trip cost to how your net worth is doing. @ points it at a specific account, payee, or tag.",
    demo: lastMonth,
  },
  {
    title: "Plugin marketplace",
    description:
      "Extend the agent with new capabilities. Install plugins other people have built from the marketplace, like a subscription audit, or describe a routine, like a monthly review, and the agent builds a plugin for you.",
    link: { label: "Browse the marketplace", href: "/docs/marketplace" },
    demo: subscriptionAudit,
  },
  {
    title: "Any LLM, fully local if you want",
    description:
      "Sign in with your ChatGPT or Claude subscription, or use an API key from Anthropic, OpenAI, Google, and more. Or run a local model with Ollama, and nothing ever leaves your machine.",
    link: { label: "Go fully local", href: "/docs/go-fully-local" },
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
