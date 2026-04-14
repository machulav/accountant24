import { afterEach, describe, expect, mock, test } from "bun:test";
import { createHeaderFactory } from "..";

const origSpawn = Bun.spawn;
afterEach(() => {
  Bun.spawn = origSpawn;
});

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes are control chars by definition
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAll(lines: string[]): string {
  return lines.map((l) => l.replace(ANSI_RE, "")).join("\n");
}

function makeMockProc(exitCode: number, stdout = "") {
  return {
    stdout: new Blob([stdout]).stream(),
    stderr: new Blob([""]).stream(),
    exited: Promise.resolve(exitCode),
    kill: () => {},
  };
}

describe("createHeaderFactory()", () => {
  test("should return a factory function", () => {
    const factory = createHeaderFactory();
    expect(typeof factory).toBe("function");
  });

  test("should return a renderable component", () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(1));
    const factory = createHeaderFactory();
    const tui = { requestRender: mock(() => {}) };
    const header = factory(tui, {});
    expect(typeof header.render).toBe("function");
  });

  test("should render empty before async data loads", () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(1));
    const factory = createHeaderFactory();
    const tui = { requestRender: mock(() => {}) };
    const header = factory(tui, {});
    // Before the async fetchBriefingData resolves, active is null → empty render
    const lines = header.render(80);
    expect(lines).toEqual([]);
  });

  test("should call requestRender after data loads", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(0));
    const factory = createHeaderFactory();
    const tui = { requestRender: mock(() => {}) };
    factory(tui, {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(tui.requestRender).toHaveBeenCalledWith(true);
  });

  test("should show onboarding when no data", async () => {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => makeMockProc(1));
    const factory = createHeaderFactory();
    const tui = { requestRender: mock(() => {}) };
    const header = factory(tui, {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    const text = stripAll(header.render(80));
    expect(text).toContain("No transactions yet");
  });

  test("should show briefing when data exists", async () => {
    const nw = `"account","balance"\n"Assets:Checking","5000.00 USD"\n"total","5000.00 USD"`;
    let callIdx = 0;
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = mock(() => {
      return callIdx++ === 0 ? makeMockProc(0, nw) : makeMockProc(1);
    });
    const factory = createHeaderFactory();
    const tui = { requestRender: mock(() => {}) };
    const header = factory(tui, {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    const text = stripAll(header.render(80));
    expect(text).toContain("Net Worth");
    expect(text).not.toContain("No transactions yet");
  });
});
