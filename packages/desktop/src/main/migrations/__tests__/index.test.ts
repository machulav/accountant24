// The shipped migration list: order is run order and ids are what gets
// recorded, so both are part of the contract. env.ts pulls in Electron for
// unrelated path helpers; it is the only fake here.

import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getAppPath: () => "/app" } }));

describe("MIGRATIONS", () => {
  it("should list the shipped migrations in order, 0001, 0002, then 0003", async () => {
    const { MIGRATIONS } = await import("../index");
    expect(MIGRATIONS.map((m) => m.id)).toEqual([
      "0001-relocate-legacy-home",
      "0002-relocate-legacy-home-over-unused",
      "0003-ignore-uv-dir",
    ]);
  });
});
