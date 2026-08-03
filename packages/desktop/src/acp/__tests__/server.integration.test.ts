import {
  client as acpClient,
  type ClientContext,
  methods,
  PROTOCOL_VERSION,
  type SessionNotification,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import type { AcpConfig } from "../config";
import { type AcpDeps, createAcpAgent } from "../server";

// Drives the real ACP agent over the SDK's in-process transport, with a fake pi
// runtime standing in for the agent. Asserts the wire contract a client (Buzz,
// Zed) actually depends on.

const MODELS = [
  { provider: "anthropic", id: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { provider: "openai", id: "gpt-5.5", name: "GPT-5.5" },
];

const config = (overrides: Partial<AcpConfig> = {}): AcpConfig =>
  ({
    workspace: { workspaceDir: "/ws", sessionsDir: "/ws/sessions" },
    resources: {},
    host: { workspaceDir: "/ws" },
    defaultModel: undefined,
    enabledModels: undefined,
    version: "1.2.3",
    ...overrides,
  }) as AcpConfig;

/** A fake pi runtime whose prompt() emits a scripted event stream. */
function fakeRuntime(script: object[] = []) {
  const listeners: ((event: object) => void)[] = [];
  const session = {
    model: MODELS[0] as unknown,
    subscribe: (listener: (event: object) => void) => {
      listeners.push(listener);
      return () => {
        listeners.splice(listeners.indexOf(listener), 1);
      };
    },
    prompt: vi.fn(async () => {
      for (const event of script) for (const l of [...listeners]) l(event);
    }),
    abort: vi.fn(async () => {}),
    setModel: vi.fn(async (model: unknown) => {
      session.model = model;
    }),
  };
  return { session, dispose: vi.fn(async () => {}) };
}

interface Harness {
  updates: SessionUpdate[];
  runtimes: ReturnType<typeof fakeRuntime>[];
}

/** Run `op` against a live agent connection, collecting session/update notifications. */
async function withAgent<T>(
  op: (cx: ClientContext, h: Harness) => Promise<T>,
  opts: { deps?: Partial<AcpDeps>; script?: object[] } = {},
): Promise<T> {
  const harness: Harness = { updates: [], runtimes: [] };
  let n = 0;
  const agentApp = createAcpAgent({
    config: config(),
    modelRegistry: { getAvailable: () => MODELS },
    newSessionPath: () => `/ws/sessions/session-${++n}.jsonl`,
    createRuntime: async () => {
      const runtime = fakeRuntime(opts.script ?? []);
      harness.runtimes.push(runtime);
      return runtime as never;
    },
    ...opts.deps,
  });

  const clientApp = acpClient().onNotification(methods.client.session.update, (ctx) => {
    harness.updates.push((ctx.params as SessionNotification).update);
  });

  return clientApp.connectWith(agentApp, (cx) => op(cx, harness));
}

const initialize = (cx: ClientContext) =>
  cx.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });

const newSession = (cx: ClientContext, cwd = "/some/other/dir") =>
  cx.request(methods.agent.session.new, { cwd, mcpServers: [] });

const textPrompt = (text: string) => [{ type: "text" as const, text }];

describe("initialize", () => {
  it("should answer with protocol version 1 and the agent's identity", async () => {
    const res = await withAgent((cx) => initialize(cx));
    expect(res.protocolVersion).toBe(1);
    expect(res.agentInfo).toEqual({ name: "accountant24", title: "Accountant24", version: "1.2.3" });
  });

  // Buzz asks for 2 as a deliberate pre-standard pin; the spec says answer with
  // the latest version we actually support.
  it("should still answer 1 when the client requests a newer protocol version", async () => {
    const res = await withAgent((cx) =>
      cx.request(methods.agent.initialize, { protocolVersion: 2, clientCapabilities: {} }),
    );
    expect(res.protocolVersion).toBe(1);
  });

  it("should advertise image and embedded-context prompt support but not loadSession", async () => {
    const res = await withAgent((cx) => initialize(cx));
    expect(res.agentCapabilities).toMatchObject({
      loadSession: false,
      promptCapabilities: { image: true, audio: false, embeddedContext: true },
    });
  });

  it("should advertise no auth methods when a provider is configured", async () => {
    const res = await withAgent((cx) => initialize(cx));
    expect(res.authMethods).toEqual([]);
  });

  it("should point at the app when no provider is configured", async () => {
    const res = await withAgent((cx) => initialize(cx), {
      deps: { modelRegistry: { getAvailable: () => [] } },
    });
    expect(res.authMethods).toHaveLength(1);
    expect(res.authMethods?.[0]).toMatchObject({ id: "accountant24-app" });
  });

  it("should degrade to no-provider rather than fail when the model registry throws", async () => {
    const res = await withAgent((cx) => initialize(cx), {
      deps: {
        modelRegistry: {
          getAvailable: () => {
            throw new Error("models.json is corrupt");
          },
        },
      },
    });
    expect(res.authMethods).toHaveLength(1);
  });
});

describe("session/new", () => {
  it("should return a session id and the model picker", async () => {
    const res = await withAgent(async (cx) => newSession(cx));
    expect(res.sessionId).toBe("/ws/sessions/session-1.jsonl");
    expect(res.configOptions).toEqual([
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "anthropic/claude-sonnet-5",
        options: [
          { value: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
          { value: "openai/gpt-5.5", name: "GPT-5.5" },
        ],
      },
    ]);
  });

  it("should apply the app's default model to the fresh session", async () => {
    const { runtimes } = await withAgent(
      async (cx, h) => {
        await newSession(cx);
        return h;
      },
      { deps: { config: config({ defaultModel: "openai/gpt-5.5" }) } },
    );
    expect(runtimes[0].session.setModel).toHaveBeenCalledWith(MODELS[1]);
  });

  it("should leave pi's own default alone when the configured model is unavailable", async () => {
    const { runtimes } = await withAgent(
      async (cx, h) => {
        await newSession(cx);
        return h;
      },
      { deps: { config: config({ defaultModel: "removed/model" }) } },
    );
    expect(runtimes[0].session.setModel).not.toHaveBeenCalled();
  });

  it("should offer no picker when no model is available", async () => {
    const res = await withAgent(async (cx) => newSession(cx), {
      deps: { modelRegistry: { getAvailable: () => [] } },
    });
    expect(res.configOptions).toEqual([]);
  });

  it("should give concurrent sessions distinct ids", async () => {
    const [a, b] = await withAgent(async (cx) => Promise.all([newSession(cx), newSession(cx)]));
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  // Deliberate deviations, both documented in the Connect docs page. They are
  // reported on stderr so the reason is visible in the client's agent log.
  describe("deliberate deviations", () => {
    it("should ignore the client's cwd and say so, since it always works on the ledger", async () => {
      const log = vi.fn();
      await withAgent(async (cx) => newSession(cx, "/some/other/dir"), { deps: { log } });
      expect(log).toHaveBeenCalledWith(expect.stringContaining("ignoring client cwd /some/other/dir"));
    });

    it("should not log when the client's cwd already is the workspace", async () => {
      const log = vi.fn();
      await withAgent(async (cx) => newSession(cx, "/ws"), { deps: { log } });
      expect(log).not.toHaveBeenCalledWith(expect.stringContaining("ignoring client cwd"));
    });

    it("should ignore MCP servers and say so, since the pi SDK has no MCP client", async () => {
      const log = vi.fn();
      const res = await withAgent(
        async (cx) =>
          cx.request(methods.agent.session.new, {
            cwd: "/ws",
            mcpServers: [{ name: "files", command: "mcp-files", args: [], env: [] }],
          }),
        { deps: { log } },
      );
      expect(log).toHaveBeenCalledWith(expect.stringContaining("ignoring 1 MCP server"));
      // Ignored, not rejected: the session still opens.
      expect(res.sessionId).toBeTruthy();
    });
  });
});

describe("session/prompt", () => {
  it("should stream assistant text and end the turn", async () => {
    const script = [
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "You spent " } },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "42 EUR." } },
    ];
    const { res, updates } = await withAgent(
      async (cx, h) => {
        const { sessionId } = await newSession(cx);
        const res = await cx.request(methods.agent.session.prompt, {
          sessionId,
          prompt: textPrompt("how much did I spend?"),
        });
        return { res, updates: h.updates };
      },
      { script },
    );

    expect(res).toEqual({ stopReason: "end_turn" });
    expect(updates).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "You spent " } },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "42 EUR." } },
    ]);
  });

  it("should report tool calls as they start and finish", async () => {
    const script = [
      { type: "tool_execution_start", toolCallId: "c1", toolName: "query", args: { q: "balance" } },
      {
        type: "tool_execution_end",
        toolCallId: "c1",
        toolName: "query",
        result: { content: [{ type: "text", text: "42 EUR" }] },
        isError: false,
      },
    ];
    const updates = await withAgent(
      async (cx, h) => {
        const { sessionId } = await newSession(cx);
        await cx.request(methods.agent.session.prompt, { sessionId, prompt: textPrompt("balance?") });
        return h.updates;
      },
      { script },
    );

    expect(updates[0]).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "c1",
      title: "Query Ledger",
      kind: "search",
      status: "in_progress",
    });
    expect(updates[1]).toMatchObject({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed" });
  });

  it("should pass the prompt text through to pi", async () => {
    const { runtimes } = await withAgent(async (cx, h) => {
      const { sessionId } = await newSession(cx);
      await cx.request(methods.agent.session.prompt, { sessionId, prompt: textPrompt("hello") });
      return h;
    });
    expect(runtimes[0].session.prompt).toHaveBeenCalledWith("hello", expect.objectContaining({ images: [] }));
  });

  it("should reject an unknown session with invalid params", async () => {
    await expect(
      withAgent((cx) => cx.request(methods.agent.session.prompt, { sessionId: "nope", prompt: textPrompt("hi") })),
    ).rejects.toMatchObject({ code: -32602 });
  });

  // The SDK maps its authRequired helper to -32000 (it uses -32002 for
  // resource-not-found), so assert the helper's real code.
  it("should fail with auth_required when no provider is configured", async () => {
    await expect(
      withAgent(
        async (cx) => {
          const { sessionId } = await newSession(cx);
          return cx.request(methods.agent.session.prompt, { sessionId, prompt: textPrompt("hi") });
        },
        { deps: { modelRegistry: { getAvailable: () => [] } } },
      ),
    ).rejects.toMatchObject({ code: -32000 });
  });
});

describe("session/cancel", () => {
  it("should abort the run and resolve the turn as cancelled", async () => {
    const { res, runtimes } = await withAgent(async (cx, h) => {
      const { sessionId } = await newSession(cx);
      // Cancel lands while the prompt is in flight.
      h.runtimes[0].session.prompt.mockImplementation(async () => {
        await cx.notify(methods.agent.session.cancel, { sessionId });
      });
      const res = await cx.request(methods.agent.session.prompt, { sessionId, prompt: textPrompt("long one") });
      return { res, runtimes: h.runtimes };
    });

    expect(res).toEqual({ stopReason: "cancelled" });
    expect(runtimes[0].session.abort).toHaveBeenCalled();
  });

  it("should treat a thrown abort as cancelled rather than an error", async () => {
    const res = await withAgent(async (cx, h) => {
      const { sessionId } = await newSession(cx);
      h.runtimes[0].session.prompt.mockImplementation(async () => {
        await cx.notify(methods.agent.session.cancel, { sessionId });
        throw new Error("The operation was aborted");
      });
      return cx.request(methods.agent.session.prompt, { sessionId, prompt: textPrompt("long one") });
    });
    expect(res).toEqual({ stopReason: "cancelled" });
  });

  it("should surface a genuine failure instead of swallowing it", async () => {
    await expect(
      withAgent(async (cx, h) => {
        const { sessionId } = await newSession(cx);
        h.runtimes[0].session.prompt.mockImplementation(async () => {
          throw new Error("provider exploded");
        });
        return cx.request(methods.agent.session.prompt, { sessionId, prompt: textPrompt("hi") });
      }),
    ).rejects.toThrow(/provider exploded/);
  });

  it("should ignore a cancel for an unknown session", async () => {
    await expect(
      withAgent(async (cx) => cx.notify(methods.agent.session.cancel, { sessionId: "nope" })),
    ).resolves.toBeUndefined();
  });
});

describe("session/set_config_option", () => {
  it("should switch the model and return the complete option list", async () => {
    const { res, runtimes } = await withAgent(async (cx, h) => {
      const { sessionId } = await newSession(cx);
      const res = await cx.request(methods.agent.session.setConfigOption, {
        sessionId,
        configId: "model",
        value: "openai/gpt-5.5",
      });
      return { res, runtimes: h.runtimes };
    });

    expect(runtimes[0].session.setModel).toHaveBeenCalledWith(MODELS[1]);
    expect(res.configOptions).toHaveLength(1);
    expect(res.configOptions[0]).toMatchObject({ id: "model", currentValue: "openai/gpt-5.5" });
  });

  it("should also broadcast the change as a config_option_update", async () => {
    const updates = await withAgent(async (cx, h) => {
      const { sessionId } = await newSession(cx);
      await cx.request(methods.agent.session.setConfigOption, {
        sessionId,
        configId: "model",
        value: "openai/gpt-5.5",
      });
      return h.updates;
    });
    expect(updates).toContainEqual(expect.objectContaining({ sessionUpdate: "config_option_update" }));
  });

  it("should reject an unknown config id", async () => {
    await expect(
      withAgent(async (cx) => {
        const { sessionId } = await newSession(cx);
        return cx.request(methods.agent.session.setConfigOption, { sessionId, configId: "theme", value: "dark" });
      }),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it("should reject an unknown model value", async () => {
    await expect(
      withAgent(async (cx) => {
        const { sessionId } = await newSession(cx);
        return cx.request(methods.agent.session.setConfigOption, {
          sessionId,
          configId: "model",
          value: "nope/nope",
        });
      }),
    ).rejects.toMatchObject({ code: -32602 });
  });
});

describe("unsupported methods", () => {
  // Buzz probes extension methods and treats a `{}` success as "delivered"; the
  // only safe answer for something we do not implement is method-not-found.
  it("should answer method not found rather than a bare success", async () => {
    await expect(withAgent((cx) => cx.request("_some/extension/method", {}))).rejects.toMatchObject({ code: -32601 });
  });

  it("should answer method not found for session/load, which we do not advertise", async () => {
    await expect(
      withAgent((cx) => cx.request(methods.agent.session.load, { sessionId: "x", cwd: "/ws", mcpServers: [] })),
    ).rejects.toMatchObject({ code: -32601 });
  });
});
