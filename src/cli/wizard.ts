import { cancel, intro, isCancel, log, outro, password, select, spinner } from "@clack/prompts";
import { completeSimple, getEnvApiKey, getModel } from "@mariozechner/pi-ai";
import type { BeanclawConfig } from "../core/config.js";
import { BEANCLAW_HOME, getProviderEnvVar, setApiKeyEnv } from "../core/config.js";
import { PROVIDER_MODELS, scaffoldProject, verifyApiKey } from "./wizard.utils.js";

function handleCancel(value: unknown): asserts value is string {
  if (isCancel(value)) {
    cancel("Setup cancelled.");
    process.exit(0);
  }
}

export async function runWizard(): Promise<BeanclawConfig> {
  intro("Welcome! Let's set up your BeanClaw.");

  // 1. Provider
  const provider = await select({
    message: "Choose LLM provider",
    options: [
      { value: "anthropic", label: "Anthropic", hint: "Claude models" },
      { value: "openai", label: "OpenAI", hint: "GPT models" },
    ],
  });
  handleCancel(provider);

  // 2. Model
  const model = await select({
    message: "Choose model",
    options: PROVIDER_MODELS[provider],
  });
  handleCancel(model);

  // 3 + 4. API key with retry
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

  // 5. Scaffold
  const s2 = spinner();
  s2.start("Setting up BeanClaw...");

  const config: BeanclawConfig = {
    llm_provider: provider,
    llm_model: model,
    api_key: apiKey,
  };

  scaffoldProject({ config, baseDir: BEANCLAW_HOME });

  s2.stop(`BeanClaw workspace is set up at ${BEANCLAW_HOME}`);

  outro("You're all set!");

  return config;
}
