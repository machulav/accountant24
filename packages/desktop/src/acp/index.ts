// Entry for the ACP agent: stdio wiring only, all logic lives in server.ts and
// the translation modules (this file is excluded from coverage as entry glue).
//
// Launched by an ACP client via resources/accountant24-acp. Nothing here may
// import Electron: this process runs under ELECTRON_RUN_AS_NODE (packaged) or
// plain node (dev).

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import { createPiRuntimeFactory, createRegistries } from "../main/agent/host/runtime";
import { loadAcpConfig } from "./config";
import { createAcpAgent } from "./server";

// stdout IS the protocol stream: one stray line corrupts it and the client
// drops the connection. Capture the real writer for the transport, then send
// everything else (pi's own console output included) to stderr, which ACP
// reserves for logging.
const writeStdout = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
const log = (message: string): void => {
  process.stderr.write(`[accountant24-acp] ${message}\n`);
};

// Adopts the workspace: agent env (PATH with the vendored hledger, …) and cwd.
// Must happen before the runtime loads the extension.
const config = loadAcpConfig();

const registries = createRegistries(config.host.workspaceDir);

// Writes through the captured stdout, not the patched process.stdout.
const protocolOut = new Writable({
  write(chunk, _encoding, callback) {
    writeStdout(chunk);
    callback();
  },
});

const stream = ndJsonStream(
  Writable.toWeb(protocolOut) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
);

const app = createAcpAgent({
  config,
  createRuntime: createPiRuntimeFactory(config.host, registries),
  modelRegistry: registries.modelRegistry,
  // Same scheme as the desktop app's router, so ACP chats sit alongside the
  // app's own in ~/Accountant24/sessions.
  newSessionPath: () =>
    resolve(config.workspace.sessionsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID()}.jsonl`),
  log,
});

const connection = app.connect(stream);
log(`ready (protocol v1, workspace ${config.workspace.workspaceDir})`);

connection.closed.then(
  () => process.exit(0),
  (error: unknown) => {
    log(`connection closed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
