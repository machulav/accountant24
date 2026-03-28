process.env.PI_SKIP_VERSION_CHECK = "1";

import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  InteractiveMode,
  SessionManager,
  SettingsManager,
  VERSION,
} from "@mariozechner/pi-coding-agent";
import { ACCOUNTANT24_HOME, accountant24Extension } from "./extension";

async function main() {
  const resourceLoader = new DefaultResourceLoader({
    cwd: ACCOUNTANT24_HOME,
    agentDir: ACCOUNTANT24_HOME,
    extensionFactories: [accountant24Extension],
    noSkills: true,
    noPromptTemplates: true,
  });
  await resourceLoader.reload();

  const settingsManager = SettingsManager.create(ACCOUNTANT24_HOME, ACCOUNTANT24_HOME);
  settingsManager.applyOverrides({
    quietStartup: true,
    collapseChangelog: true,
    lastChangelogVersion: VERSION,
  });

  const { session, modelFallbackMessage } = await createAgentSession({
    cwd: ACCOUNTANT24_HOME,
    agentDir: ACCOUNTANT24_HOME,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.create(ACCOUNTANT24_HOME, join(ACCOUNTANT24_HOME, "sessions")),
  });

  await new InteractiveMode(session, { modelFallbackMessage }).run();
}

main();
