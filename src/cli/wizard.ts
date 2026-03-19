import { cancel, intro, isCancel, log, outro, password, select, spinner } from "@clack/prompts";
import { completeSimple, getEnvApiKey, getModel } from "@mariozechner/pi-ai";
import type { OAuthCredentials } from "@mariozechner/pi-ai/oauth";
import type { Accountant24Config } from "../core/config.js";
import { ACCOUNTANT24_HOME, getProviderEnvVar, setApiKeyEnv } from "../core/config.js";
import { AUTH_METHODS, PROVIDER_MODELS, performOAuthLogin, scaffoldProject, verifyApiKey } from "./wizard.utils.js";

/** Map wizard provider to OAuth provider ID */
const OAUTH_PROVIDER_MAP: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai-codex",
};

/** Map wizard provider to effective LLM provider when using OAuth */
const OAUTH_LLM_PROVIDER_MAP: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai-codex",
};

function handleCancel(value: unknown): asserts value is string {
  if (isCancel(value)) {
    cancel("Setup cancelled.");
    process.exit(0);
  }
}

export async function runWizard(): Promise<Accountant24Config> {
  intro("Welcome! Let's set up your Accountant24.");

  // 1. Provider
  const provider = await select({
    message: "Choose LLM provider",
    options: [
      { value: "anthropic", label: "Anthropic", hint: "Claude models" },
      { value: "openai", label: "OpenAI", hint: "GPT models" },
    ],
  });
  handleCancel(provider);

  // 2. Auth method
  const authMethod = await select({
    message: "Choose authentication method",
    options: AUTH_METHODS[provider],
  });
  handleCancel(authMethod);

  if (authMethod === "oauth") {
    // OAuth flow
    const oauthProviderId = OAUTH_PROVIDER_MAP[provider];
    const effectiveProvider = OAUTH_LLM_PROVIDER_MAP[provider];

    // Login — keep-alive interval prevents Bun from exiting while the
    // OAuth callback server (node:http) is waiting for the browser redirect.
    log.step("Complete authentication in your browser");
    let credentials: OAuthCredentials;
    const keepAlive = setInterval(() => {}, 30_000);
    try {
      credentials = await performOAuthLogin(oauthProviderId);
    } catch (e: any) {
      console.error("\nOAuth login failed:", e);
      process.exit(1);
    } finally {
      clearInterval(keepAlive);
    }
    log.step("Authentication successful!");

    // Model selection (use OAuth-specific models if available)
    const modelList = PROVIDER_MODELS[effectiveProvider] ?? PROVIDER_MODELS[provider];
    const model = await select({
      message: "Choose model",
      options: modelList,
    });
    handleCancel(model);

    // Verify with a test completion
    const sv = spinner();
    sv.start("Verifying connection...");
    const accessToken = credentials.access;
    const result = await verifyApiKey(effectiveProvider, model, accessToken, {
      getModel: getModel as any,
      completeSimple,
    });
    if (!result.ok) {
      sv.stop("Verification failed");
      log.error(result.error);
      process.exit(1);
    }
    sv.stop("Connection verified");

    // Scaffold
    const s2 = spinner();
    s2.start("Setting up Accountant24...");

    const config: Accountant24Config = {
      llm_provider: effectiveProvider,
      llm_model: model,
      auth_method: "oauth",
      oauth_credentials: credentials,
    };

    scaffoldProject({ config, baseDir: ACCOUNTANT24_HOME });

    s2.stop(`Accountant24 workspace is set up at ${ACCOUNTANT24_HOME}`);
    outro("You're all set!");

    return config;
  }

  // API key flow
  // 3. Model
  const model = await select({
    message: "Choose model",
    options: PROVIDER_MODELS[provider],
  });
  handleCancel(model);

  // 4 + 5. API key with retry
  let apiKey: string;
  let envKey: string | undefined = getEnvApiKey(provider);

  while (true) {
    if (envKey) {
      apiKey = envKey;
      envKey = undefined;
    } else {
      const envVar = getProviderEnvVar(provider);
      const key = await password({
        message: `Enter your ${envVar}:`,
        validate: (v) => {
          if (!v || v.trim().length === 0) return "API key is required.";
        },
      });
      handleCancel(key);
      apiKey = key;
    }

    setApiKeyEnv(provider, apiKey);

    const s = spinner();
    s.start("Verifying API key...");

    const result = await verifyApiKey(provider, model, apiKey, {
      getModel: getModel as any,
      completeSimple,
    });

    if (!result.ok) {
      s.stop("API key verification failed");
      log.error(result.error);
      continue;
    }
    s.stop("API key verified");
    break;
  }

  // 6. Scaffold
  const s2 = spinner();
  s2.start("Setting up Accountant24...");

  const config: Accountant24Config = {
    llm_provider: provider,
    llm_model: model,
    auth_method: "api_key",
    api_key: apiKey,
  };

  scaffoldProject({ config, baseDir: ACCOUNTANT24_HOME });

  s2.stop(`Accountant24 workspace is set up at ${ACCOUNTANT24_HOME}`);

  outro("You're all set!");

  return config;
}
