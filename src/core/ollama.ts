import type { Model } from "@mariozechner/pi-ai";

export const OLLAMA_DEFAULT_URL = "http://localhost:11434";

export function createOllamaModel(modelId: string, baseUrl: string): Model<"openai-completions"> {
  return {
    api: "openai-completions",
    id: modelId,
    name: modelId,
    provider: "ollama",
    baseUrl: `${baseUrl}/v1`,
    reasoning: false,
    input: ["text"],
    contextWindow: 8192,
    maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStrictMode: false,
      supportsUsageInStreaming: false,
      maxTokensField: "max_tokens",
    },
  };
}

export async function fetchOllamaModels(baseUrl: string): Promise<{ value: string; label: string }[] | null> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { models?: { name: string }[] };
    if (!data.models || data.models.length === 0) return null;
    return data.models.map((m) => ({ value: m.name, label: m.name }));
  } catch {
    return null;
  }
}
