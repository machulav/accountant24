import { createAgent } from "../core/index.js";
import { startApp } from "./tui/app.js";

export async function start(): Promise<void> {
  const agent = createAgent();
  await startApp(agent);
}
