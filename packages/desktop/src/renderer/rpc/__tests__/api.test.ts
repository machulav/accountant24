// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeApi } from "../../test/fakeApi";

// `src/rpc/api.ts` captures `window.api` at module-load time (`const api =
// window.api`). Install the fake bridge BEFORE loading api.ts: `installFakeApi`
// itself has no load-time dependency on `window.api`, so its static import is
// safe to evaluate first; only then do we dynamically import api.ts, by which
// point `window.api` already points at the fake.
const bridge = installFakeApi();
const {
  agentApi,
  analyticsApi,
  appApi,
  authApi,
  dlog,
  filesApi,
  ledgerApi,
  sessionsApi,
  settingsApi,
  skillsApi,
  updateApi,
} = await import("../api");

/** The only I/O boundary is `window.api`; reset it between tests. */
beforeEach(() => bridge.reset());
afterEach(() => bridge.reset());

/** Convenience: the single payload sent to a channel (asserts exactly one call). */
function onlyPayload(channel: string): unknown {
  const payloads = bridge.callsFor(channel);
  expect(payloads).toHaveLength(1);
  return payloads[0];
}

describe("agentApi", () => {
  describe("createSession()", () => {
    it("should invoke the 'agent_create_session' channel and resolve the minted path", async () => {
      bridge.setHandler("agent_create_session", () => "/ws/sessions/new.jsonl");

      const result = await agentApi.createSession();

      expect(result).toBe("/ws/sessions/new.jsonl");
      expect(bridge.callsFor("agent_create_session")).toEqual([undefined]);
    });
  });

  describe("send()", () => {
    it("should invoke 'agent_send' with the session path and the command object", async () => {
      const command = { type: "user", text: "hi" };
      bridge.setHandler("agent_send", () => undefined);

      await agentApi.send("/ws/sessions/a.jsonl", command);

      expect(onlyPayload("agent_send")).toEqual({ sessionPath: "/ws/sessions/a.jsonl", command });
    });
  });

  describe("restart()", () => {
    it("should invoke 'agent_restart' and notify onModelsChanged subscribers", async () => {
      bridge.setHandler("agent_restart", () => undefined);
      const cb = vi.fn();
      agentApi.onModelsChanged(cb);

      await agentApi.restart();

      expect(bridge.callsFor("agent_restart")).toEqual([undefined]);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("should dispatch the models-changed event AFTER the invoke resolves", async () => {
      const order: string[] = [];
      bridge.setHandler("agent_restart", () => {
        order.push("invoke");
      });
      agentApi.onModelsChanged(() => order.push("event"));

      await agentApi.restart();

      expect(order).toEqual(["invoke", "event"]);
    });
  });

  describe("onModelsChanged()", () => {
    it("should stop firing the callback after the returned unsubscribe is called", async () => {
      bridge.setHandler("agent_restart", () => undefined);
      const cb = vi.fn();
      const unsubscribe = agentApi.onModelsChanged(cb);

      await agentApi.restart();
      unsubscribe();
      await agentApi.restart();

      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe("onEvent()", () => {
    it("should parse the JSONL line and merge the session path into the event", async () => {
      const cb = vi.fn();
      await agentApi.onEvent(cb);

      bridge.emit("agent-event", {
        sessionPath: "/ws/sessions/a.jsonl",
        line: JSON.stringify({ type: "text", value: "hello" }),
      });

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith({ type: "text", value: "hello", sessionPath: "/ws/sessions/a.jsonl" });
    });

    it("should not throw and not call the callback when the line is malformed JSON", async () => {
      const cb = vi.fn();
      await agentApi.onEvent(cb);

      expect(() =>
        bridge.emit("agent-event", { sessionPath: "/ws/sessions/a.jsonl", line: "{not valid json" }),
      ).not.toThrow();
      expect(cb).not.toHaveBeenCalled();
    });

    it("should subscribe on the 'agent-event' channel and unsubscribe cleanly", async () => {
      const cb = vi.fn();
      const unsubscribe = await agentApi.onEvent(cb);

      expect(bridge.listenerCount("agent-event")).toBe(1);
      unsubscribe();
      expect(bridge.listenerCount("agent-event")).toBe(0);
    });
  });

  describe("onTerminated()", () => {
    it("should pass the exit-info payload (with its session) through to the callback", async () => {
      const cb = vi.fn();
      await agentApi.onTerminated(cb);
      const exit = { sessionPath: "/ws/sessions/a.jsonl", code: 1, signal: null, stderr: "boom" };

      bridge.emit("agent-terminated", exit);

      expect(cb).toHaveBeenCalledWith(exit);
    });
  });

  describe("onError()", () => {
    it("should pass the error payload (with its session) through to the callback", async () => {
      const cb = vi.fn();
      await agentApi.onError(cb);

      bridge.emit("agent-error", { sessionPath: "/ws/sessions/a.jsonl", message: "spawn failed" });

      expect(cb).toHaveBeenCalledWith({ sessionPath: "/ws/sessions/a.jsonl", message: "spawn failed" });
    });
  });
});

describe("appApi", () => {
  describe("version()", () => {
    it("should invoke 'app_version' and resolve the version string", async () => {
      bridge.setHandler("app_version", () => "0.2.7");

      const result = await appApi.version();

      expect(result).toBe("0.2.7");
      expect(bridge.callsFor("app_version")).toEqual([undefined]);
    });
  });
});

describe("updateApi", () => {
  describe("pending()", () => {
    it("should invoke 'update_pending' and resolve the staged version", async () => {
      bridge.setHandler("update_pending", () => "0.3.0");

      const result = await updateApi.pending();

      expect(result).toBe("0.3.0");
      expect(bridge.callsFor("update_pending")).toEqual([undefined]);
    });

    it("should resolve null when no update is pending", async () => {
      bridge.setHandler("update_pending", () => null);

      expect(await updateApi.pending()).toBeNull();
    });
  });

  describe("install()", () => {
    it("should invoke the 'update_install' channel with no payload", async () => {
      bridge.setHandler("update_install", () => undefined);

      await updateApi.install();

      expect(bridge.callsFor("update_install")).toEqual([undefined]);
    });
  });

  describe("onDownloaded()", () => {
    it("should pass the new-version payload through to the callback", () => {
      const cb = vi.fn();
      updateApi.onDownloaded(cb);

      bridge.emit("update-downloaded", "0.3.0");

      expect(cb).toHaveBeenCalledWith("0.3.0");
    });

    it("should stop firing after the returned unsubscribe is called", () => {
      const cb = vi.fn();
      const unsubscribe = updateApi.onDownloaded(cb);

      unsubscribe();
      bridge.emit("update-downloaded", "0.3.0");

      expect(cb).not.toHaveBeenCalled();
    });
  });
});

describe("sessionsApi", () => {
  describe("list()", () => {
    it("should invoke 'sessions_list' and resolve the session list", async () => {
      const value = { type: "sessions", sessions: [{ id: "a" }] };
      bridge.setHandler("sessions_list", () => value);

      const result = await sessionsApi.list();

      expect(result).toEqual(value);
      expect(bridge.callsFor("sessions_list")).toEqual([undefined]);
    });
  });

  describe("delete()", () => {
    it("should invoke 'sessions_delete' with the { path } payload", async () => {
      bridge.setHandler("sessions_delete", () => ({ type: "deleted", path: "/s/1" }));

      const result = await sessionsApi.delete("/s/1");

      expect(onlyPayload("sessions_delete")).toEqual({ path: "/s/1" });
      expect(result).toEqual({ type: "deleted", path: "/s/1" });
    });
  });
});

describe("filesApi", () => {
  describe("archiveToWorkspace()", () => {
    it("should invoke 'files_archive_to_workspace' with { name, dataBase64 } and resolve the stored path", async () => {
      bridge.setHandler("files_archive_to_workspace", () => "attachments/receipt.png");

      const result = await filesApi.archiveToWorkspace("receipt.png", "AAAA");

      expect(onlyPayload("files_archive_to_workspace")).toEqual({
        name: "receipt.png",
        dataBase64: "AAAA",
      });
      expect(result).toBe("attachments/receipt.png");
    });
  });
});

describe("settingsApi", () => {
  describe("get()", () => {
    it("should invoke 'settings_get' and resolve the settings object", async () => {
      const settings = { defaultModel: "sonnet", telemetry: true };
      bridge.setHandler("settings_get", () => settings);

      const result = await settingsApi.get();

      expect(result).toEqual(settings);
      expect(bridge.callsFor("settings_get")).toEqual([undefined]);
    });
  });

  describe("set()", () => {
    it("should invoke 'settings_set' with the patch and resolve the merged result", async () => {
      const merged = { defaultModel: "opus", analyticsEnabled: true };
      bridge.setHandler("settings_set", () => merged);

      const result = await settingsApi.set({ defaultModel: "opus" });

      expect(onlyPayload("settings_set")).toEqual({ defaultModel: "opus" });
      expect(result).toEqual(merged);
    });

    it("should notify onChange subscribers after a set", async () => {
      bridge.setHandler("settings_set", () => ({ defaultModel: "opus" }));
      const cb = vi.fn();
      settingsApi.onChange(cb);

      await settingsApi.set({ defaultModel: "opus" });

      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("should dispatch the settings-changed event only AFTER the invoke resolves", async () => {
      const order: string[] = [];
      bridge.setHandler("settings_set", () => {
        order.push("invoke");
        return {};
      });
      settingsApi.onChange(() => order.push("event"));

      await settingsApi.set({ defaultModel: "opus" });

      expect(order).toEqual(["invoke", "event"]);
    });
  });

  describe("onChange()", () => {
    it("should stop firing the callback after the returned unsubscribe is called", async () => {
      bridge.setHandler("settings_set", () => ({}));
      const cb = vi.fn();
      const unsubscribe = settingsApi.onChange(cb);

      await settingsApi.set({ defaultModel: "opus" });
      unsubscribe();
      await settingsApi.set({ defaultModel: "sonnet" });

      expect(cb).toHaveBeenCalledTimes(1);
    });
  });
});

describe("ledgerApi", () => {
  describe("mentions()", () => {
    it("should invoke 'ledger_mentions' and resolve the mentions payload", async () => {
      const mentions = { accounts: ["Assets:Cash"], payees: [], tags: [] };
      bridge.setHandler("ledger_mentions", () => mentions);

      const result = await ledgerApi.mentions();

      expect(result).toEqual(mentions);
      expect(bridge.callsFor("ledger_mentions")).toEqual([undefined]);
    });
  });
});

describe("skillsApi", () => {
  describe("list()", () => {
    it("should invoke 'skills_list' and resolve the skills list", async () => {
      const list = { native: [], custom: [] };
      bridge.setHandler("skills_list", () => list);

      const result = await skillsApi.list();

      expect(result).toEqual(list);
      expect(bridge.callsFor("skills_list")).toEqual([undefined]);
    });
  });

  describe("add()", () => {
    it("should invoke 'skills_add' with the request object", async () => {
      const req = { url: "https://github.com/acme/skill" };
      bridge.setHandler("skills_add", () => ({ type: "added" }));

      const result = await skillsApi.add(req as never);

      expect(onlyPayload("skills_add")).toEqual(req);
      expect(result).toEqual({ type: "added" });
    });
  });

  describe("remove()", () => {
    it("should invoke 'skills_remove' with the { name } payload", async () => {
      bridge.setHandler("skills_remove", () => ({ type: "removed" }));

      await skillsApi.remove("my-skill");

      expect(onlyPayload("skills_remove")).toEqual({ name: "my-skill" });
    });
  });

  describe("setEnabled()", () => {
    it("should invoke 'skills_set_enabled' with { name, enabled }", async () => {
      bridge.setHandler("skills_set_enabled", () => ({ type: "ok" }));

      await skillsApi.setEnabled("my-skill", false);

      expect(onlyPayload("skills_set_enabled")).toEqual({ name: "my-skill", enabled: false });
    });
  });

  describe("onEvent()", () => {
    it("should pass the skills-event payload through to the callback", async () => {
      const cb = vi.fn();
      await skillsApi.onEvent(cb);
      const event = { type: "progress", line: "cloning..." };

      bridge.emit("skills-event", event);

      expect(cb).toHaveBeenCalledWith(event);
    });
  });
});

describe("analyticsApi", () => {
  describe("track()", () => {
    it("should invoke 'analytics_track' with { event, props }", async () => {
      bridge.setHandler("analytics_track", () => undefined);

      analyticsApi.track("button_click", { id: "save" });
      await Promise.resolve();

      expect(onlyPayload("analytics_track")).toEqual({
        event: "button_click",
        props: { id: "save" },
      });
    });

    it("should send undefined props when none are passed", async () => {
      bridge.setHandler("analytics_track", () => undefined);

      analyticsApi.track("app_open");
      await Promise.resolve();

      expect(onlyPayload("analytics_track")).toEqual({ event: "app_open", props: undefined });
    });

    it("should swallow a rejected invoke without throwing (fire-and-forget)", async () => {
      bridge.setHandler("analytics_track", () => {
        throw new Error("main is down");
      });

      expect(() => analyticsApi.track("button_click")).not.toThrow();
      // Let the rejected invoke's .catch() run.
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  describe("trackOnce()", () => {
    it("should invoke 'analytics_track' with once:true added to the payload", async () => {
      bridge.setHandler("analytics_track", () => undefined);

      analyticsApi.trackOnce("first_transaction", { source: "import" });
      await Promise.resolve();

      expect(onlyPayload("analytics_track")).toEqual({
        event: "first_transaction",
        props: { source: "import" },
        once: true,
      });
    });

    it("should swallow a rejected invoke without throwing (fire-and-forget)", async () => {
      bridge.setHandler("analytics_track", () => {
        throw new Error("main is down");
      });

      expect(() => analyticsApi.trackOnce("first_message")).not.toThrow();
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});

describe("authApi", () => {
  describe("status()", () => {
    it("should invoke 'auth_status' and resolve the status", async () => {
      const status = { type: "status", providers: [], availableModels: 0 };
      bridge.setHandler("auth_status", () => status);

      const result = await authApi.status();

      expect(result).toEqual(status);
      expect(bridge.callsFor("auth_status")).toEqual([undefined]);
    });
  });

  describe("providers()", () => {
    it("should invoke 'auth_providers' and resolve the providers", async () => {
      const providers = { type: "providers", items: [] };
      bridge.setHandler("auth_providers", () => providers);

      const result = await authApi.providers();

      expect(result).toEqual(providers);
      expect(bridge.callsFor("auth_providers")).toEqual([undefined]);
    });
  });

  describe("models()", () => {
    it("should invoke 'auth_models' and resolve the models", async () => {
      const models = { type: "models", items: [] };
      bridge.setHandler("auth_models", () => models);

      const result = await authApi.models();

      expect(result).toEqual(models);
      expect(bridge.callsFor("auth_models")).toEqual([undefined]);
    });
  });

  describe("setKey()", () => {
    it("should invoke 'auth_set_key' with { provider, key }", async () => {
      bridge.setHandler("auth_set_key", () => ({ type: "ok" }));

      await authApi.setKey("openai", "sk-123");

      expect(onlyPayload("auth_set_key")).toEqual({ provider: "openai", key: "sk-123" });
    });
  });

  describe("logout()", () => {
    it("should invoke 'auth_logout' with { provider }", async () => {
      bridge.setHandler("auth_logout", () => ({ type: "ok" }));

      await authApi.logout("openai");

      expect(onlyPayload("auth_logout")).toEqual({ provider: "openai" });
    });
  });

  describe("detectOllama()", () => {
    it("should invoke 'auth_detect_ollama' and resolve the info", async () => {
      const info = { running: true, models: ["llama3"] };
      bridge.setHandler("auth_detect_ollama", () => info);

      const result = await authApi.detectOllama();

      expect(result).toEqual(info);
      expect(bridge.callsFor("auth_detect_ollama")).toEqual([undefined]);
    });
  });

  describe("addOllama()", () => {
    it("should invoke 'auth_add_ollama' with { model }", async () => {
      bridge.setHandler("auth_add_ollama", () => ({ type: "ok" }));

      await authApi.addOllama("llama3");

      expect(onlyPayload("auth_add_ollama")).toEqual({ model: "llama3" });
    });
  });

  describe("addAllOllama()", () => {
    it("should invoke 'auth_add_all_ollama' with no payload and resolve the count", async () => {
      bridge.setHandler("auth_add_all_ollama", () => ({ type: "ok", count: 3 }));

      const result = await authApi.addAllOllama();

      expect(result).toEqual({ type: "ok", count: 3 });
      expect(bridge.callsFor("auth_add_all_ollama")).toEqual([undefined]);
    });
  });

  describe("removeOllama()", () => {
    it("should invoke 'auth_remove_ollama' with no payload", async () => {
      bridge.setHandler("auth_remove_ollama", () => ({ type: "ok" }));

      await authApi.removeOllama();

      expect(bridge.callsFor("auth_remove_ollama")).toEqual([undefined]);
    });
  });

  describe("login()", () => {
    it("should invoke 'auth_login' with { provider }", async () => {
      bridge.setHandler("auth_login", () => undefined);

      await authApi.login("anthropic");

      expect(onlyPayload("auth_login")).toEqual({ provider: "anthropic" });
    });
  });

  describe("loginRespond()", () => {
    it("should invoke 'auth_login_respond' with { id, value }", async () => {
      bridge.setHandler("auth_login_respond", () => undefined);

      await authApi.loginRespond("req-1", "code-abc");

      expect(onlyPayload("auth_login_respond")).toEqual({ id: "req-1", value: "code-abc" });
    });

    it("should forward a null value in the { id, value } payload", async () => {
      bridge.setHandler("auth_login_respond", () => undefined);

      await authApi.loginRespond("req-1", null);

      expect(onlyPayload("auth_login_respond")).toEqual({ id: "req-1", value: null });
    });
  });

  describe("loginCancel()", () => {
    it("should invoke 'auth_login_cancel' with no payload", async () => {
      bridge.setHandler("auth_login_cancel", () => undefined);

      await authApi.loginCancel();

      expect(bridge.callsFor("auth_login_cancel")).toEqual([undefined]);
    });
  });

  describe("onEvent()", () => {
    it("should pass the auth-event payload through to the callback", async () => {
      const cb = vi.fn();
      await authApi.onEvent(cb);
      const event = { type: "prompt", id: "req-1" };

      bridge.emit("auth-event", event);

      expect(cb).toHaveBeenCalledWith(event);
    });
  });

  describe("onTerminated()", () => {
    it("should pass the exit-code payload through to the callback", async () => {
      const cb = vi.fn();
      await authApi.onTerminated(cb);

      bridge.emit("auth-terminated", 0);

      expect(cb).toHaveBeenCalledWith(0);
    });
  });
});

describe("dlog()", () => {
  it("should write the message to console.debug with the [a24] tag", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => undefined);

    dlog("hello");

    expect(spy).toHaveBeenCalledWith("[a24]", "hello");
    spy.mockRestore();
  });
});
