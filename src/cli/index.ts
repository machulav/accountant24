import { createAgent, loadConfig, setApiKeyEnv } from "../core/index.js";
import { createLogo, startApp } from "./tui/app.js";
import { createTheme } from "./tui/theme.js";
import { runWizard } from "./wizard.js";

export async function start(): Promise<void> {
  const existing = loadConfig();

  if (!existing) {
    const theme = createTheme();
    console.log(createLogo(theme));
    const config = await runWizard();
    if (config.auth_method === "api_key" && config.api_key) {
      setApiKeyEnv(config.llm_provider, config.api_key);
    }
    const agent = await createAgent(config);
    await startApp(agent, { showLogo: false });
  } else {
    if (existing.auth_method === "api_key" && existing.api_key) {
      setApiKeyEnv(existing.llm_provider, existing.api_key);
    }
    const agent = await createAgent(existing);
    await startApp(agent);
  }
}
