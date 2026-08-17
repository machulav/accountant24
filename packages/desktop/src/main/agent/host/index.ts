// utilityProcess entry for the agent host. Wiring only — all logic lives in
// host.ts / runtime.ts (this file is excluded from coverage as entry glue).

import { mkdirSync } from "node:fs";
import type { AgentHostConfig, AgentHostRequest } from "../../../shared/agentHost";
import { AgentHost } from "./host";
import { createRuntimeFactory } from "./runtime";

const cfg = JSON.parse(process.argv[2] ?? "{}") as AgentHostConfig;
// The workspace is every session's cwd and must exist before the first runtime
// is created. Main seeds it at launch (main/workspace.ts); this guards a
// workspace deleted while the app runs.
mkdirSync(cfg.workspaceDir, { recursive: true });

const host = new AgentHost({
  createRuntime: createRuntimeFactory(cfg),
  post: (notice) => process.parentPort.postMessage(notice),
});

process.parentPort.on("message", (message) => {
  host.handleMessage(message.data as AgentHostRequest);
});
host.startReaper();

// Electron SIGTERMs utility processes on kill(); abort in-flight runs and tear
// sessions down before exiting so bash children don't outlive the host.
process.once("SIGTERM", () => {
  void host.disposeAll().finally(() => process.exit(143));
});
