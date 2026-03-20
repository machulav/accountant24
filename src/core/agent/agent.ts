import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";
import { getOAuthApiKey } from "@mariozechner/pi-ai/oauth";
import type { Accountant24Config } from "../config.js";
import { writeConfig } from "../config.js";
import { createOllamaModel } from "../ollama.js";
import { createTools } from "../tools/index.js";
import { getSystemPrompt, loadSystemPromptContext } from "./system-prompt.js";

export async function createAgent(config: Accountant24Config): Promise<Agent> {
  const context = await loadSystemPromptContext();

  const model =
    config.llm_provider === "ollama" && config.base_url
      ? createOllamaModel(config.llm_model, config.base_url)
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (getModel as any)(config.llm_provider, config.llm_model);

  let getApiKeyFn: ((provider: string) => Promise<string | undefined>) | undefined;

  if (config.llm_provider === "ollama") {
    getApiKeyFn = async () => "ollama";
  } else if (config.auth_method === "oauth" && config.oauth_credentials) {
    const oauthState: { credentials: Record<string, OAuthCredentials> } = {
      credentials: { [config.llm_provider]: config.oauth_credentials },
    };

    getApiKeyFn = async (provider: string) => {
      const result = await getOAuthApiKey(provider, oauthState.credentials);
      if (!result) return undefined;
      // If token was refreshed, update stored credentials and persist
      if (result.newCredentials !== oauthState.credentials[provider]) {
        oauthState.credentials[provider] = result.newCredentials;
        config.oauth_credentials = result.newCredentials;
        writeConfig(config);
      }
      return result.apiKey;
    };
  }

  return new Agent({
    initialState: {
      systemPrompt: getSystemPrompt(context),
      model,
      tools: createTools(),
    },
    streamFn: streamSimple,
    getApiKey: getApiKeyFn,
  });
}
