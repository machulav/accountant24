// The sessions list over a REAL temp workspace with the REAL pi SessionManager:
// the sidebar must show every chat stored in the workspace's own sessions dir,
// including ones recorded while the workspace folder lived at another path
// (pre-0.3 ~/Accountant24, a --workspace folder that was moved, a restored
// backup). Only Electron and the router are faked.

import { mkdirSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTmpWorkspace } from "../../__tests__/tmpWorkspace";

type Handler = (event: unknown, payload?: unknown) => unknown;
const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  killSessionAgent: vi.fn(async () => {}),
}));

vi.mock("electron", () => ({
  app: { isPackaged: false, getAppPath: () => "/app" },
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      h.handlers.set(channel, fn);
    },
  },
}));
vi.mock("../router", () => ({ killSessionAgent: h.killSessionAgent }));

const ws = makeTmpWorkspace();

beforeEach(() => {
  ws.setup();
  h.handlers.clear();
  vi.resetModules();
});
afterEach(() => ws.cleanup());

/** A minimal pi session file: the header line plus one user message. */
function writeSession(name: string, id: string, cwd: string, text: string): string {
  const file = ws.path("sessions", name);
  mkdirSync(ws.path("sessions"), { recursive: true });
  const header = { type: "session", version: 3, id, timestamp: "2026-08-01T10:00:00.000Z", cwd };
  const message = {
    type: "message",
    id: `${id}-m1`,
    parentId: null,
    timestamp: "2026-08-01T10:00:01.000Z",
    message: { role: "user", content: [{ type: "text", text }], timestamp: 1785578401000 },
  };
  writeFileSync(file, `${JSON.stringify(header)}\n${JSON.stringify(message)}\n`);
  return file;
}

async function listSessions(): Promise<{ id: string; path: string; firstMessage: string; messageCount: number }[]> {
  const { registerSessionsIpc } = await import("../sessions");
  registerSessionsIpc();
  const handler = h.handlers.get("sessions_list");
  if (!handler) throw new Error("no handler for sessions_list");
  const result = (await handler(null)) as { type: string; sessions: never[] };
  expect(result.type).toBe("sessions");
  return result.sessions;
}

describe("sessions_list (real workspace, real pi)", () => {
  it("should list a chat recorded in another workspace path next to one recorded here", async () => {
    const here = writeSession("2026-08-20T10-00-00-000Z_here.jsonl", "here", ws.dir, "groceries this month");
    const moved = writeSession(
      "2026-06-01T10-00-00-000Z_old.jsonl",
      "old",
      "/Users/someone/Accountant24",
      "salary in june",
    );

    const sessions = await listSessions();

    expect(sessions.map((s) => s.id).sort()).toEqual(["here", "old"]);
    expect(sessions.find((s) => s.id === "old")).toMatchObject({
      path: moved,
      firstMessage: "salary in june",
      messageCount: 1,
    });
    expect(sessions.find((s) => s.id === "here")).toMatchObject({ path: here, firstMessage: "groceries this month" });
  });

  it("should return an empty list when the sessions dir does not exist yet", async () => {
    await expect(listSessions()).resolves.toEqual([]);
  });
});
