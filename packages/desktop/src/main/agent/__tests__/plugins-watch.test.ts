import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// plugins-watch.ts turns raw fs events on the workspace plugins folder into
// the app's "plugins changed" pipeline: one debounced notification to the
// renderer plus an agent recycle, suppressed while an install holds the lock.
// The watch itself is the faked I/O boundary (injected); the debounce, lock
// and notify logic run for real.

const h = vi.hoisted(() => ({
  ws: "",
  appListeners: new Map<string, () => void>(),
  sendToWindow: vi.fn(),
  recycleAgentsWhenIdle: vi.fn(),
  lockHeld: false,
  withInstallLock: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    on: (event: string, fn: () => void) => {
      h.appListeners.set(event, fn);
    },
  },
}));
vi.mock("../../env", () => ({
  pluginsDir: () => join(h.ws, "plugins"),
}));
vi.mock("../plugins", () => ({ withInstallLock: h.withInstallLock }));
vi.mock("../router", () => ({ recycleAgentsWhenIdle: h.recycleAgentsWhenIdle }));

const win = { isDestroyed: () => false, webContents: { send: h.sendToWindow } };

/** A fake fs.watch: records the watched path, exposes the change callback. */
function makeWatch() {
  const state = {
    dir: "",
    options: undefined as unknown,
    onChange: () => {},
    onError: undefined as ((error: Error) => void) | undefined,
    close: vi.fn(),
  };
  const watch = ((dir: string, options: unknown, listener: () => void) => {
    state.dir = dir;
    state.options = options;
    state.onChange = listener;
    return {
      close: state.close,
      on: (event: string, fn: (error: Error) => void) => {
        if (event === "error") state.onError = fn;
      },
    };
  }) as never;
  return { state, watch };
}

async function start(getWin: () => unknown = () => win, watch?: unknown) {
  const fake = makeWatch();
  const mod = await import("../plugins-watch");
  mod.startPluginsWatcher(getWin as never, { watch: (watch ?? fake.watch) as never });
  return { fake, mod };
}

beforeEach(() => {
  h.ws = mkdtempSync(join(tmpdir(), "a24-watch-"));
  h.appListeners.clear();
  h.lockHeld = false;
  h.withInstallLock.mockImplementation(async (fn: () => Promise<unknown>) => (h.lockHeld ? undefined : fn()));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.useFakeTimers();
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  rmSync(h.ws, { recursive: true, force: true });
});

describe("startPluginsWatcher()", () => {
  it("should create the plugins folder and watch it recursively", async () => {
    const { fake } = await start();

    expect(existsSync(join(h.ws, "plugins"))).toBe(true);
    expect(fake.state.dir).toBe(join(h.ws, "plugins"));
    expect(fake.state.options).toEqual({ recursive: true });
  });

  it("should send one changed event and one recycle after a burst of fs events settles", async () => {
    const { fake } = await start();

    fake.state.onChange();
    fake.state.onChange();
    fake.state.onChange();
    await vi.advanceTimersByTimeAsync(1000);

    expect(h.sendToWindow).toHaveBeenCalledTimes(1);
    expect(h.sendToWindow).toHaveBeenCalledWith("plugins-event", { type: "changed" });
    expect(h.recycleAgentsWhenIdle).toHaveBeenCalledTimes(1);
  });

  it("should hold the fire while events keep arriving inside the debounce window", async () => {
    const { fake } = await start();

    fake.state.onChange();
    await vi.advanceTimersByTimeAsync(999);
    fake.state.onChange();
    await vi.advanceTimersByTimeAsync(999);
    expect(h.sendToWindow).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(h.sendToWindow).toHaveBeenCalledTimes(1);
    expect(h.recycleAgentsWhenIdle).toHaveBeenCalledTimes(1);
  });

  it("should still recycle the agents when no window is open", async () => {
    const { fake } = await start(() => null);

    fake.state.onChange();
    await vi.advanceTimersByTimeAsync(1000);

    expect(h.sendToWindow).not.toHaveBeenCalled();
    expect(h.recycleAgentsWhenIdle).toHaveBeenCalledTimes(1);
  });

  it("should neither notify nor recycle while an install holds the lock", async () => {
    const { fake } = await start();
    h.lockHeld = true;

    fake.state.onChange();
    await vi.advanceTimersByTimeAsync(1000);

    expect(h.sendToWindow).not.toHaveBeenCalled();
    expect(h.recycleAgentsWhenIdle).not.toHaveBeenCalled();
  });

  it("should warn and keep the app alive when the watch cannot start", async () => {
    const watch = () => {
      throw new Error("EMFILE: too many open files");
    };

    await expect(start(() => win, watch)).resolves.toBeDefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("EMFILE"));
  });

  it("should warn when the running watcher reports an error", async () => {
    const { fake } = await start();

    fake.state.onError?.(new Error("watch died"));

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("watch died"));
  });

  it("should close the watcher and drop a pending fire on will-quit", async () => {
    const { fake } = await start();

    fake.state.onChange();
    h.appListeners.get("will-quit")?.();
    await vi.advanceTimersByTimeAsync(1000);

    expect(fake.state.close).toHaveBeenCalledTimes(1);
    expect(h.sendToWindow).not.toHaveBeenCalled();
    expect(h.recycleAgentsWhenIdle).not.toHaveBeenCalled();
  });

  it("should not send to a destroyed window", async () => {
    const { fake } = await start(() => ({ isDestroyed: () => true, webContents: { send: h.sendToWindow } }));

    fake.state.onChange();
    await vi.advanceTimersByTimeAsync(1000);

    expect(h.sendToWindow).not.toHaveBeenCalled();
    expect(h.recycleAgentsWhenIdle).toHaveBeenCalledTimes(1);
  });
});
