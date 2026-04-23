process.env.PI_SKIP_VERSION_CHECK = "1";

import { join } from "node:path";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  InteractiveMode,
  SessionManager,
  SettingsManager,
  VERSION,
} from "@mariozechner/pi-coding-agent";
import { minimatch } from "minimatch";
import { ACCOUNTANT24_HOME, createExtension } from "./extension";

// Align the library's getAgentDir() with our workspace so displayed paths (e.g. "Credentials saved to …") match actual file locations.
process.env.PI_CODING_AGENT_DIR = ACCOUNTANT24_HOME;

const SETTINGS_OVERRIDES = {
  quietStartup: true,
  collapseChangelog: true,
  lastChangelogVersion: VERSION,
  terminal: { showImages: false, clearOnShrink: false },
  images: { autoResize: false, blockImages: false },
} as const;

async function main() {
  const settingsManager = SettingsManager.create(ACCOUNTANT24_HOME, ACCOUNTANT24_HOME);
  settingsManager.applyOverrides(SETTINGS_OVERRIDES);

  const sessionManager = SessionManager.create(ACCOUNTANT24_HOME, join(ACCOUNTANT24_HOME, "sessions"));

  const runtime = await createAgentSessionRuntime(
    async ({ cwd, agentDir, sessionManager: sm, sessionStartEvent }) => {
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        settingsManager,
        resourceLoaderOptions: {
          extensionFactories: [createExtension(settingsManager)],
          noSkills: true,
          noPromptTemplates: true,
        },
      });

      // Re-apply overrides — resourceLoader.reload() inside createAgentSessionServices
      // reloads settings from disk, which discards in-memory overrides.
      settingsManager.applyOverrides(SETTINGS_OVERRIDES);

      const result = await createAgentSessionFromServices({
        services,
        sessionManager: sm,
        sessionStartEvent,
      });

      return { ...result, services, diagnostics: services.diagnostics };
    },
    {
      cwd: ACCOUNTANT24_HOME,
      agentDir: ACCOUNTANT24_HOME,
      sessionManager,
    },
  );

  // Resolve enabledModels from settings into scopedModels so /model shows the filtered list
  const enabledModels = settingsManager.getEnabledModels();
  if (enabledModels && enabledModels.length > 0) {
    const available = runtime.session.modelRegistry.getAvailable();
    const matched = available.filter((m) => {
      const fullId = `${m.provider}/${m.id}`;
      return enabledModels.some(
        (pattern) => minimatch(fullId, pattern, { nocase: true }) || minimatch(m.id, pattern, { nocase: true }),
      );
    });
    if (matched.length > 0) {
      runtime.session.setScopedModels(matched.map((model) => ({ model })));
    }
  }

  await new InteractiveMode(runtime, { modelFallbackMessage: runtime.modelFallbackMessage }).run();
}

main();
