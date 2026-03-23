import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  InteractiveMode,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
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
    sessionManager: SessionManager.create(ACCOUNTANT24_HOME, join(ACCOUNTANT24_HOME, ".sessions")),
  });

  await new InteractiveMode(session, { modelFallbackMessage }).run();
}

main();
