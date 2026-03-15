import { createAgent, loadConfig, setApiKeyEnv } from "../core/index.js";
import { startApp, createLogo } from "./tui/app.js";
import { createTheme } from "./tui/theme.js";
import { runWizard } from "./wizard.js";

export async function start(): Promise<void> {
  const existing = loadConfig();

  if (!existing) {
    const theme = createTheme();
    console.log(createLogo(theme));
    const config = await runWizard();
    setApiKeyEnv(config.llm_provider, config.api_key);
    const agent = createAgent(config.llm_provider, config.llm_model);
    await startApp(agent, { showLogo: false });
  } else {
    setApiKeyEnv(existing.llm_provider, existing.api_key);
    const agent = createAgent(existing.llm_provider, existing.llm_model);
    await startApp(agent);
  }
}
