import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const BEANCLAW_HOME = join(homedir(), "beanclaw");
export const CONFIG_PATH = join(BEANCLAW_HOME, "config.json");
export const MEMORY_PATH = join(BEANCLAW_HOME, "memory.json");
export const LEDGER_DIR = join(BEANCLAW_HOME, "ledger");

const ConfigSchema = z.object({
  llm_provider: z.string(),
  llm_model: z.string(),
  api_key: z.string().min(1),
});

export type BeanclawConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): BeanclawConfig | null {
  try {
    if (!existsSync(CONFIG_PATH)) return null;
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = ConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeConfig(config: BeanclawConfig): void {
  mkdirSync(BEANCLAW_HOME, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

const ENV_VAR_MAP: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export function getProviderEnvVar(provider: string): string {
  return ENV_VAR_MAP[provider] ?? `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
}

export function setApiKeyEnv(provider: string, apiKey: string): void {
  const envVar = getProviderEnvVar(provider);
  if (!process.env[envVar]) {
    process.env[envVar] = apiKey;
  }
}
