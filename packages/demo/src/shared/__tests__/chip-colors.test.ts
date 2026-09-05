import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The mock window's chips must look like the app's. Both sides hardcode the
// hex values (the app in Tailwind arbitrary values), so this test is what
// keeps them in step: it fails when the app's palette moves and the demo's
// does not.
const ROOT = join(import.meta.dirname, "../../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const hexes = (source: string) => new Set(source.match(/#[0-9a-f]{6}/gi)?.map((hex) => hex.toLowerCase()) ?? []);

describe("mock chip colors", () => {
  const mock = hexes(read("packages/demo/src/shared/components/mock-scene.astro"));

  it("should use every color the app's mention pills use", () => {
    const app = hexes(read("packages/desktop/src/renderer/components/accountant24/mentions.tsx"));
    expect(app.size).toBeGreaterThan(0);
    expect([...app].filter((hex) => !mock.has(hex))).toEqual([]);
  });

  it("should use every color the app's skill pill uses", () => {
    const app = hexes(read("packages/desktop/src/renderer/components/accountant24/skill-pill.tsx"));
    expect(app.size).toBeGreaterThan(0);
    expect([...app].filter((hex) => !mock.has(hex))).toEqual([]);
  });
});
