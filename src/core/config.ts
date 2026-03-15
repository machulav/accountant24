import type { KnownProvider } from "@mariozechner/pi-ai";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const PROVIDER = requireEnv("BEANCLAW_PROVIDER") as KnownProvider;
export const MODEL = requireEnv("BEANCLAW_MODEL");
