// The ACP agent: the handlers an ACP client (Buzz, Zed, …) drives over stdio.
//
// Deliberate deviations from a generic coding agent, both documented in the
// Connect docs page:
//
//   * `cwd` from session/new is ignored. Accountant24 is a ledger agent, so it
//     always works on ~/Accountant24 rather than on whatever folder the client
//     happens to be sitting in.
//   * `mcpServers` is ignored (logged to stderr). The pi SDK has no MCP client.
//
// We never call the client's fs/* or terminal/* methods: our tools run inside
// the workspace with the vendored binaries.

import {
  type AgentApp,
  type AgentContext,
  agent,
  type InitializeResponse,
  methods,
  type NewSessionResponse,
  PROTOCOL_VERSION,
  type PromptResponse,
  RequestError,
  type SessionConfigOption,
  type SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk";
import type { AcpConfig } from "./config";
import { toSessionUpdate } from "./events";
import { findModel, MODEL_CONFIG_ID, modelConfigOption, type PiModel } from "./models";
import { toPiPrompt } from "./prompt";
import { SessionStore } from "./sessions";

/** The slice of pi's ModelRegistry this module needs. */
export interface AcpModelRegistry {
  getAvailable(): PiModel[] | Promise<PiModel[]>;
}

export interface AcpDeps {
  config: AcpConfig;
  createRuntime: Parameters<SessionStore["open"]>[1];
  modelRegistry: AcpModelRegistry;
  /** Mints a fresh pi session-file path; the ACP sessionId. */
  newSessionPath: () => string;
  /** Diagnostics sink. stdout is the protocol stream, so this must not use it. */
  log?: (message: string) => void;
}

/** Shown when the workspace has no configured provider. ACP's `terminal` and
 *  `env_var` auth methods do not fit: credentials are set up in the app's UI. */
const APP_AUTH_METHOD = {
  id: "accountant24-app",
  name: "Connect a provider in Accountant24",
  description: "Open Accountant24, then go to Settings, Providers and connect a model provider.",
};

const NO_MODEL_MESSAGE =
  "No model provider is configured. Open Accountant24, go to Settings, Providers and connect one, then try again.";

export function createAcpAgent(deps: AcpDeps): AgentApp {
  const { config, modelRegistry, newSessionPath } = deps;
  const log = deps.log ?? (() => {});
  const store = new SessionStore();
  let client: AgentContext | undefined;

  const available = async (): Promise<PiModel[]> => {
    try {
      return await modelRegistry.getAvailable();
    } catch {
      // A malformed models.json must not take down the handshake; it surfaces
      // as "no provider configured" instead.
      return [];
    }
  };

  const currentModel = (session: { runtime: { session: { model?: unknown } } }): PiModel | undefined => {
    const model = session.runtime.session.model as PiModel | undefined;
    return model && typeof model.provider === "string" ? model : undefined;
  };

  const configOptions = async (session: Parameters<typeof currentModel>[0]): Promise<SessionConfigOption[]> => {
    const option = modelConfigOption(await available(), config.enabledModels, currentModel(session));
    return option ? [option] : [];
  };

  const require = (sessionId: string) => {
    const session = store.get(sessionId);
    if (!session) throw RequestError.invalidParams(undefined, `Unknown sessionId: ${sessionId}`);
    return session;
  };

  return agent({ name: "accountant24" })
    .onConnect((connection) => {
      // Session updates are streamed outside any inbound request, so they need
      // a connection-scoped context rather than a handler's.
      client = connection.client;
    })

    .onRequest(methods.agent.initialize, async (): Promise<InitializeResponse> => {
      const models = await available();
      return {
        protocolVersion: PROTOCOL_VERSION,
        agentInfo: { name: "accountant24", title: "Accountant24", version: config.version },
        agentCapabilities: {
          // Sessions are replayable JSONL on disk, but replaying them as
          // session/update notifications is not implemented yet.
          loadSession: false,
          promptCapabilities: { image: true, audio: false, embeddedContext: true },
          mcpCapabilities: { http: false, sse: false },
        },
        // Advertising an auth method with no way to satisfy it in-protocol would
        // be worse than none, so this only appears when auth is actually missing.
        authMethods: models.length > 0 ? [] : [APP_AUTH_METHOD],
      };
    })

    .onRequest(methods.agent.session.new, async (ctx): Promise<NewSessionResponse> => {
      if (ctx.params.mcpServers?.length) {
        log(`ignoring ${ctx.params.mcpServers.length} MCP server(s): the pi SDK has no MCP client`);
      }
      if (ctx.params.cwd && ctx.params.cwd !== config.workspace.workspaceDir) {
        log(`ignoring client cwd ${ctx.params.cwd}; Accountant24 always works on ${config.workspace.workspaceDir}`);
      }

      const sessionId = newSessionPath();
      const session = await store.open(sessionId, deps.createRuntime, (event) => {
        const update = toSessionUpdate(event as Parameters<typeof toSessionUpdate>[0]);
        if (!update || !client) return;
        void client.notify(methods.client.session.update, { sessionId, update }).catch(() => {
          // The client went away mid-turn; the connection close will clean up.
        });
      });

      // Without this the session silently falls back to pi's first available
      // model instead of the one chosen in the app.
      if (config.defaultModel) {
        const model = findModel(await available(), config.defaultModel);
        if (model) await session.runtime.session.setModel(model as never);
      }

      return { sessionId, configOptions: await configOptions(session) };
    })

    .onRequest(methods.agent.session.prompt, async (ctx): Promise<PromptResponse> => {
      const session = require(ctx.params.sessionId);
      if ((await available()).length === 0) throw RequestError.authRequired(undefined, NO_MODEL_MESSAGE);

      const { message, images } = toPiPrompt(ctx.params.prompt);
      session.cancelled = false;
      try {
        await session.runtime.session.prompt(message, { images, source: "rpc" } as never);
      } catch (error) {
        // pi surfaces an abort as a thrown error; the spec wants a semantically
        // meaningful stop reason instead.
        if (!session.cancelled) {
          // A plain throw would reach the client as a bare "Internal error".
          // Re-wrap so the real reason (rate limit, bad key, context overflow)
          // is what the user sees.
          if (error instanceof RequestError) throw error;
          throw RequestError.internalError(undefined, error instanceof Error ? error.message : String(error));
        }
      }
      return { stopReason: session.cancelled ? "cancelled" : "end_turn" };
    })

    .onNotification(methods.agent.session.cancel, async (ctx) => {
      const session = store.get(ctx.params.sessionId);
      if (!session) return;
      session.cancelled = true;
      await session.runtime.session.abort();
    })

    .onRequest(methods.agent.session.setConfigOption, async (ctx): Promise<SetSessionConfigOptionResponse> => {
      const session = require(ctx.params.sessionId);
      if (ctx.params.configId !== MODEL_CONFIG_ID) {
        throw RequestError.invalidParams(undefined, `Unknown config option: ${ctx.params.configId}`);
      }
      const value = ctx.params.value;
      const model = typeof value === "string" ? findModel(await available(), value) : undefined;
      if (!model) throw RequestError.invalidParams(undefined, `Unknown model: ${String(value)}`);

      await session.runtime.session.setModel(model as never);
      const options = await configOptions(session);
      if (client) {
        void client
          .notify(methods.client.session.update, {
            sessionId: session.id,
            update: { sessionUpdate: "config_option_update", configOptions: options },
          })
          .catch(() => {});
      }
      return { configOptions: options };
    });
}
