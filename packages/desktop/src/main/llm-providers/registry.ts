// Shared pi SDK access for the provider modules — run IN-PROCESS (no agent
// process needed): stock pi has no headless auth command, and credentials must
// live in auth.json before an agent session starts. AuthStorage + ModelRegistry
// read/write auth.json + models.json in the workspace — the same files the
// agent reads (their only interface with the agent side).

import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { workspaceDir } from "../env";

export function paths() {
  const home = workspaceDir();
  return { home, authPath: join(home, "auth.json"), modelsPath: join(home, "models.json") };
}

export function createRegistry() {
  const { authPath, modelsPath } = paths();
  const authStorage = AuthStorage.create(authPath);
  const modelRegistry = ModelRegistry.create(authStorage, modelsPath);
  return { authStorage, modelRegistry };
}
