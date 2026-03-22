import { createAgentSession, DefaultResourceLoader, InteractiveMode } from "@mariozechner/pi-coding-agent";
import { ACCOUNTANT24_HOME } from "./core/config.js";
import { accountant24Extension } from "./extension.js";

async function main() {
  const resourceLoader = new DefaultResourceLoader({
    cwd: ACCOUNTANT24_HOME,
    extensionFactories: [accountant24Extension],
    noSkills: true,
    noPromptTemplates: true,
  });
  await resourceLoader.reload();

  const { session, modelFallbackMessage } = await createAgentSession({
    cwd: ACCOUNTANT24_HOME,
    resourceLoader,
  });

  await new InteractiveMode(session, { modelFallbackMessage }).run();
}

main();
