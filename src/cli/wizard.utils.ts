import { exec } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log, text } from "@clack/prompts";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";
import { getOAuthProvider } from "@mariozechner/pi-ai/oauth";
import chalk from "chalk";
import type { Accountant24Config } from "../core/config.js";

export const PROVIDER_MODELS: Record<string, { value: string; label: string; hint?: string }[]> = {
  anthropic: [
    {
      value: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      hint: "recommended",
    },
    {
      value: "claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      hint: "fast & cheap",
    },
  ],
  openai: [
    { value: "gpt-5.4", label: "GPT-5.4", hint: "recommended" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 mini", hint: "fast & cheap" },
  ],
  "openai-codex": [
    { value: "gpt-5.4", label: "GPT-5.4", hint: "recommended" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 mini", hint: "fast & cheap" },
  ],
};

export const AUTH_METHODS: Record<string, { value: string; label: string; hint?: string }[]> = {
  anthropic: [
    { value: "api_key", label: "API Key", hint: "enter your ANTHROPIC_API_KEY" },
    { value: "oauth", label: "Claude Account", hint: "log in with Claude Pro/Max subscription" },
  ],
  openai: [
    { value: "api_key", label: "API Key", hint: "enter your OPENAI_API_KEY" },
    { value: "oauth", label: "ChatGPT Account", hint: "log in with ChatGPT Plus/Pro (Codex)" },
  ],
};

export async function performOAuthLogin(oauthProviderId: string): Promise<OAuthCredentials> {
  const provider = getOAuthProvider(oauthProviderId);
  if (!provider) {
    throw new Error(`OAuth provider "${oauthProviderId}" not found`);
  }

  return provider.login({
    onAuth: (info) => {
      log.step(`Opening browser for authentication...\n${chalk.dim(info.url)}`);
      if (info.instructions) {
        log.step(info.instructions);
      }
      try {
        const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        exec(`${cmd} ${JSON.stringify(info.url)}`, () => {});
      } catch {
        log.warn("Could not open browser automatically. Please open the URL above manually.");
      }
    },
    onPrompt: async (prompt) => {
      const value = await text({
        message: prompt.message ?? "Paste the code here:",
        placeholder: prompt.placeholder,
      });
      if (typeof value !== "string") {
        throw new Error("Authentication cancelled");
      }
      return value;
    },
    onProgress: (message) => {
      log.step(message);
    },
  });
}

export const DEFAULT_ACCOUNTS: readonly string[] = [
  "Assets:Checking",
  "Assets:Savings",
  "Assets:Cash",
  "Liabilities:CreditCard",
  "Income:Salary",
  "Income:Other",
  "Expenses:Groceries",
  "Expenses:Rent",
  "Expenses:Utilities",
  "Expenses:Transport",
  "Expenses:Dining",
  "Expenses:Entertainment",
  "Expenses:Health",
  "Expenses:Shopping",
  "Expenses:Other",
  "Equity:Opening-Balances",
];

export function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type CompleteFn = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => Promise<AssistantMessage>;

export type GetModelFn = (provider: string, model: string) => Model<Api>;

export type VerifyResult = { ok: true } | { ok: false; error: string };

export async function verifyApiKey(
  provider: string,
  modelId: string,
  apiKey: string,
  deps: { getModel: GetModelFn; completeSimple: CompleteFn },
): Promise<VerifyResult> {
  try {
    const m = deps.getModel(provider, modelId);
    const result = await deps.completeSimple(
      m,
      {
        systemPrompt: "Respond with exactly: OK",
        messages: [{ role: "user", content: "Say OK", timestamp: Date.now() }],
      },
      { maxTokens: 16, apiKey },
    );
    if (result.stopReason === "error") {
      return {
        ok: false,
        error: result.errorMessage ?? "Invalid API key or could not connect to the LLM provider.",
      };
    }
    return { ok: true };
  } catch (e: any) {
    return {
      ok: false,
      error: e.message ?? "Could not connect to the LLM provider.",
    };
  }
}

export interface ScaffoldOptions {
  config: Accountant24Config;
  baseDir: string;
  date?: string;
}

function writeIfNotExists(filePath: string, content: string): void {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, content);
  }
}

export function scaffoldProject(options: ScaffoldOptions): void {
  const { config, baseDir } = options;
  const ledgerDir = join(baseDir, "ledger");

  mkdirSync(ledgerDir, { recursive: true });
  mkdirSync(join(baseDir, "documents"), { recursive: true });
  mkdirSync(join(baseDir, ".sessions"), { recursive: true });

  writeFileSync(join(baseDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);

  writeIfNotExists(join(baseDir, "memory.json"), `${JSON.stringify({ facts: [] }, null, 2)}\n`);

  writeIfNotExists(join(ledgerDir, "main.journal"), `; Accountant24 Personal Finances\n\ninclude accounts.journal\n`);

  const accountLines = DEFAULT_ACCOUNTS.map((a) => `account ${a}`).join("\n");
  writeIfNotExists(join(ledgerDir, "accounts.journal"), `${accountLines}\n`);

  writeIfNotExists(join(baseDir, ".gitignore"), ".sessions/\nconfig.json\n");
}
