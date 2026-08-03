import { describe, expect, it, vi } from "vitest";
import type { UiBridge } from "../../main/agent/host/host";
import { autoAnsweringUi, SessionStore } from "../sessions";

/** A fake pi runtime; only the slice the store touches. */
function fakeRuntime() {
  const listeners: ((event: object) => void)[] = [];
  return {
    listeners,
    session: {
      subscribe: vi.fn((listener: (event: object) => void) => {
        listeners.push(listener);
        return () => {
          listeners.splice(listeners.indexOf(listener), 1);
        };
      }),
      abort: vi.fn(async () => {}),
    },
    dispose: vi.fn(async () => {}),
  };
}

/** Register a waiter the way pi's extension UI context does, then emit. */
function askDialog(ui: UiBridge, id: string, method: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    ui.pending.set(id, { resolve, reject });
    ui.emit({ type: "extension_ui_request", id, method });
  });
}

describe("autoAnsweringUi()", () => {
  // A blocking dialog with nobody to answer it would hang the turn forever,
  // and ACP has no way to surface one.
  it("should confirm a blocking confirm dialog", async () => {
    const ui = autoAnsweringUi();
    await expect(askDialog(ui, "ui1", "confirm")).resolves.toEqual({ confirmed: true });
  });

  it("should answer an input dialog with an empty value", async () => {
    const ui = autoAnsweringUi();
    await expect(askDialog(ui, "ui1", "input")).resolves.toEqual({ confirmed: true, value: "" });
  });

  it("should answer select and editor dialogs too", async () => {
    const ui = autoAnsweringUi();
    await expect(askDialog(ui, "ui1", "select")).resolves.toEqual({ confirmed: true });
    await expect(askDialog(ui, "ui2", "editor")).resolves.toEqual({ confirmed: true });
  });

  it("should not leak the waiter once answered", async () => {
    const ui = autoAnsweringUi();
    await askDialog(ui, "ui1", "confirm");
    expect(ui.pending.size).toBe(0);
  });

  it("should ignore display-only events, which register no waiter", () => {
    const ui = autoAnsweringUi();
    expect(() => ui.emit({ type: "extension_ui_request", id: "ui9", method: "notify", message: "hi" })).not.toThrow();
    expect(ui.pending.size).toBe(0);
  });

  it("should ignore an event with no id", () => {
    const ui = autoAnsweringUi();
    expect(() => ui.emit({ type: "extension_ui_request", method: "notify" })).not.toThrow();
  });
});

describe("SessionStore", () => {
  const open = (store: SessionStore, id: string, runtime = fakeRuntime(), onEvent = vi.fn()) =>
    store.open(id, async () => runtime as never, onEvent).then((session) => ({ session, runtime, onEvent }));

  it("should expose an opened session by id", async () => {
    const store = new SessionStore();
    const { session } = await open(store, "s1");
    expect(store.get("s1")).toBe(session);
    expect(session.cancelled).toBe(false);
  });

  it("should return undefined for an unknown id", () => {
    expect(new SessionStore().get("nope")).toBeUndefined();
  });

  it("should forward runtime events to the listener", async () => {
    const store = new SessionStore();
    const { runtime, onEvent } = await open(store, "s1");
    runtime.listeners[0]({ type: "agent_start" });
    expect(onEvent).toHaveBeenCalledWith({ type: "agent_start" });
  });

  it("should abort, dispose and forget the session on dispose", async () => {
    const store = new SessionStore();
    const { session, runtime } = await open(store, "s1");
    await session.dispose();

    expect(runtime.session.abort).toHaveBeenCalled();
    expect(runtime.dispose).toHaveBeenCalled();
    expect(store.get("s1")).toBeUndefined();
  });

  it("should stop forwarding events after dispose", async () => {
    const store = new SessionStore();
    const { session, runtime, onEvent } = await open(store, "s1");
    await session.dispose();
    expect(runtime.listeners).toHaveLength(0);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("should still forget the session when teardown throws", async () => {
    const store = new SessionStore();
    const runtime = fakeRuntime();
    runtime.session.abort.mockRejectedValue(new Error("already gone"));
    const { session } = await open(store, "s1", runtime);

    await expect(session.dispose()).resolves.toBeUndefined();
    expect(store.get("s1")).toBeUndefined();
  });

  it("should dispose every open session", async () => {
    const store = new SessionStore();
    const a = await open(store, "s1");
    const b = await open(store, "s2");

    await store.disposeAll();

    expect(a.runtime.dispose).toHaveBeenCalled();
    expect(b.runtime.dispose).toHaveBeenCalled();
    expect(store.get("s1")).toBeUndefined();
    expect(store.get("s2")).toBeUndefined();
  });
});
