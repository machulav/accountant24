// All copy and data for the landing page in one place. Wording follows the
// README and docs; keep it to shipped features and product vocabulary.
import { PROMPT_IDEA_GROUPS } from "../../../desktop/src/renderer/lib/promptIdeas";

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

export interface Feature {
  title: string;
  description: string;
  link?: { label: string; href: string };
}

// Every prompt idea the app deals under its composer, read straight from the
// app's list so the page and the app always share one wording.
export const promptIdeas: string[] = PROMPT_IDEA_GROUPS.flatMap((group) => group.ideas.map((idea) => idea.prompt));

export const features: Feature[] = [
  {
    title: "Natural language entry",
    description:
      "A plain sentence becomes a proper double-entry transaction in your ledger. The agent fills in the details.",
  },
  {
    title: "Statement and receipt import",
    description:
      "A PDF bank statement, an invoice, or a photo of a paper receipt becomes transactions in your ledger. The original file is archived in your workspace for later.",
  },
  {
    title: "Answers about your money",
    description:
      "The agent reads your ledger and answers clearly, from what a trip cost to how your net worth is doing. @ points it at a specific account, payee, or tag.",
  },
  {
    title: "Persistent memory",
    description:
      "The agent remembers your rules, budgets, and habits from one mention, and applies them when it matters.",
    link: { label: "How memory works", href: "/docs/memory" },
  },
  {
    title: "Plugin marketplace",
    description:
      "Extend the agent with new capabilities. Install plugins other people have built from the marketplace, or describe a routine, like a monthly review or a subscription audit, and the agent builds a plugin for you.",
    link: { label: "Browse the marketplace", href: "/docs/marketplace" },
  },
  {
    title: "Any LLM, fully local if you want",
    description:
      "Sign in with your ChatGPT or Claude subscription, or use an API key from Anthropic, OpenAI, Google, and more. Or run a local model with Ollama, and nothing ever leaves your machine.",
    link: { label: "Go fully local", href: "/docs/go-fully-local" },
  },
  {
    title: "Full change history, easy undo",
    description:
      "Every change is recorded automatically. Review what happened anytime, roll back a mistake, or keep a private backup. Under the hood it's a local git repo, the same system developers trust with their code.",
  },
];
