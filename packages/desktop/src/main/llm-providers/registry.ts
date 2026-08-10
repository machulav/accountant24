// Shared pi SDK access for the provider modules — run IN-PROCESS (no agent
// process needed): stock pi has no headless auth command, and credentials must
// live in auth.json before an agent session starts. ModelRuntime reads/writes
// auth.json + models.json in the workspace — the same files the agent reads
// (their only interface with the agent side).

import { join } from "node:path";
import { InMemoryModelsStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { workspaceDir } from "../env";

export function paths() {
  const home = workspaceDir();
  return { home, authPath: join(home, "auth.json"), modelsPath: join(home, "models.json") };
}

/** A fresh runtime per IPC call, so every handler re-reads auth.json and
 *  models.json from disk — that is how the Settings screen picks up credential
 *  changes without an app restart. Offline by construction: `allowModelNetwork`
 *  defaults to false, so the create-time refresh resolves availability from the
 *  built-in catalog, models.json and the environment, never the network.
 *
 *  The models store caches catalogs fetched over the network. We never fetch
 *  any, so an in-memory store keeps pi from writing a permanently empty
 *  models-store.json next to the user's ledger. Enabling `allowModelNetwork`
 *  later means switching this back to pi's file-backed default, which is what
 *  makes its four-hour refresh throttle survive a restart. */
export function createProviderRuntime(): Promise<ModelRuntime> {
  const { authPath, modelsPath } = paths();
  return ModelRuntime.create({ authPath, modelsPath, modelsStore: new InMemoryModelsStore() });
}
