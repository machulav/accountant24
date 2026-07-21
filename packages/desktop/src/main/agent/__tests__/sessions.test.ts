import { beforeEach, describe, expect, it, vi } from "vitest";

// sessions.ts wraps three I/O boundaries — Electron IPC, the pi SDK
// SessionManager, and node:fs. All are faked; the mapping and containment
// logic runs for real, driven through the registered IPC handlers.
type Handler = (event: unknown, payload?: unknown) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  sessionList: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  killSessionAgent: vi.fn(async () => {}),
  rmSync: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      h.handlers.set(channel, fn);
    },
  },
}));
vi.mock("../../env", () => ({ workspaceDir: () => "/ws", sessionsDir: () => "/ws/sessions" }));
vi.mock("../router", () => ({ killSessionAgent: h.killSessionAgent }));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  SessionManager: { list: (...args: unknown[]) => h.sessionList(...args) },
}));
vi.mock("node:fs", () => ({ rmSync: h.rmSync }));

/** Import sessions.ts fresh and register its handlers. */
async function setup() {
  const { registerSessionsIpc } = await import("../sessions");
  registerSessionsIpc();
}

const invoke = (channel: string, payload?: unknown) => {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(null, payload);
};

beforeEach(() => {
  h.handlers.clear();
  h.sessionList.mockImplementation(async () => []);
  vi.resetModules();
});

describe("sessions_list", () => {
  it("should map session infos, defaulting name/firstMessage and ISO-formatting dates", async () => {
    h.sessionList.mockResolvedValue([
      {
        path: "/ws/sessions/s1.jsonl",
        id: "s1",
        name: undefined,
        firstMessage: undefined,
        messageCount: 3,
        modified: new Date("2026-01-02T03:04:05Z"),
      },
    ]);
    await setup();

    await expect(invoke("sessions_list")).resolves.toEqual({
      type: "sessions",
      sessions: [
        {
          path: "/ws/sessions/s1.jsonl",
          id: "s1",
          name: "",
          firstMessage: "",
          messageCount: 3,
          modified: "2026-01-02T03:04:05.000Z",
        },
      ],
    });
    expect(h.sessionList).toHaveBeenCalledWith("/ws", "/ws/sessions");
  });

  it("should stringify a non-Date modified value", async () => {
    h.sessionList.mockResolvedValue([
      { path: "p", id: "i", name: "n", firstMessage: "f", messageCount: 0, modified: 1234 },
    ]);
    await setup();

    const result = (await invoke("sessions_list")) as { sessions: { modified: string }[] };
    expect(result.sessions[0].modified).toBe("1234");
  });
});

describe("sessions_delete", () => {
  const refusal = { type: "error", message: "refusing to delete a path outside the sessions directory" };

  it("should return an error when the path is empty", async () => {
    await setup();
    await expect(invoke("sessions_delete", { path: "" })).resolves.toEqual({
      type: "error",
      message: "session path is required",
    });
  });

  it("should delete a file inside the sessions directory", async () => {
    await setup();
    await expect(invoke("sessions_delete", { path: "/ws/sessions/a.jsonl" })).resolves.toEqual({
      type: "done",
      path: "/ws/sessions/a.jsonl",
    });
    expect(h.rmSync).toHaveBeenCalledWith("/ws/sessions/a.jsonl", { force: true });
  });

  it("should dispose the live session and await the ack before removing the file", async () => {
    await setup();
    let disposed = false;
    h.killSessionAgent.mockImplementationOnce(async () => {
      // The rm must not have happened while the dispose is still in flight.
      expect(h.rmSync).not.toHaveBeenCalled();
      disposed = true;
    });
    await invoke("sessions_delete", { path: "/ws/sessions/a.jsonl" });

    expect(h.killSessionAgent).toHaveBeenCalledWith("/ws/sessions/a.jsonl");
    expect(disposed).toBe(true);
    expect(h.rmSync).toHaveBeenCalledWith("/ws/sessions/a.jsonl", { force: true });
  });

  it("should refuse a sibling directory that shares the sessions prefix", async () => {
    await setup();
    await expect(invoke("sessions_delete", { path: "/ws/sessions-backup/x.jsonl" })).resolves.toEqual(refusal);
    expect(h.rmSync).not.toHaveBeenCalled();
    expect(h.killSessionAgent).not.toHaveBeenCalled();
  });

  it("should refuse a traversal that resolves outside the sessions directory", async () => {
    await setup();
    await expect(invoke("sessions_delete", { path: "/ws/sessions/../auth.json" })).resolves.toEqual(refusal);
    expect(h.rmSync).not.toHaveBeenCalled();
  });

  it("should refuse an unrelated absolute path", async () => {
    await setup();
    await expect(invoke("sessions_delete", { path: "/etc/passwd" })).resolves.toEqual(refusal);
  });

  it("should refuse the sessions directory itself", async () => {
    await setup();
    await expect(invoke("sessions_delete", { path: "/ws/sessions" })).resolves.toEqual(refusal);
  });
});
