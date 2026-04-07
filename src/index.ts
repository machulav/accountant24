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
import { minimatch } from "minimatch";
import { ACCOUNTANT24_HOME, createExtension } from "./extension";

async function main() {
  const settingsManager = SettingsManager.create(ACCOUNTANT24_HOME, ACCOUNTANT24_HOME);
  settingsManager.applyOverrides({
    quietStartup: true,
    collapseChangelog: true,
    lastChangelogVersion: VERSION,
    terminal: { showImages: false, clearOnShrink: false },
    images: { autoResize: false, blockImages: false },
  });

  const resourceLoader = new DefaultResourceLoader({
    cwd: ACCOUNTANT24_HOME,
    agentDir: ACCOUNTANT24_HOME,
    extensionFactories: [createExtension(settingsManager)],
    noSkills: true,
    noPromptTemplates: true,
  });
  await resourceLoader.reload();

  const { session, modelFallbackMessage } = await createAgentSession({
    cwd: ACCOUNTANT24_HOME,
    agentDir: ACCOUNTANT24_HOME,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.create(ACCOUNTANT24_HOME, join(ACCOUNTANT24_HOME, "sessions")),
  });

  // Resolve enabledModels from settings into scopedModels so /model shows the filtered list
  const enabledModels = settingsManager.getEnabledModels();
  if (enabledModels && enabledModels.length > 0) {
    const available = session.modelRegistry.getAvailable();
    const matched = available.filter((m) => {
      const fullId = `${m.provider}/${m.id}`;
      return enabledModels.some(
        (pattern) => minimatch(fullId, pattern, { nocase: true }) || minimatch(m.id, pattern, { nocase: true }),
      );
    });
    if (matched.length > 0) {
      session.setScopedModels(matched.map((model) => ({ model })));
    }
  }

  await new InteractiveMode(session, { modelFallbackMessage }).run();
}

main();
