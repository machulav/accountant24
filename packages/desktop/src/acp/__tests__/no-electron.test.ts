import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The ACP entry runs under ELECTRON_RUN_AS_NODE (packaged) or plain node (dev).
// In neither case does `require("electron")` give a usable `app`, so a single
// stray import anywhere in this module graph breaks the launcher at runtime
// with an error that would not show up in any other test.

const ACP_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g;

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(IMPORT_RE)].map((m) => m[1]);
}

/** Resolve a relative specifier to a .ts file on disk. */
function resolveLocal(fromFile: string, specifier: string): string | undefined {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Every source file reachable from the ACP entry, following relative imports. */
function moduleGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const queue = readdirSync(ACP_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(ACP_DIR, f));

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (graph.has(file)) continue;
    const specifiers = importsOf(file);
    graph.set(file, specifiers);
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue;
      const target = resolveLocal(file, specifier);
      if (target && !graph.has(target)) queue.push(target);
    }
  }
  return graph;
}

describe("the ACP module graph", () => {
  it("should reach more than just the entry files", () => {
    // Guards the guard: a broken resolver would make the assertion below vacuous.
    const graph = moduleGraph();
    expect(graph.size).toBeGreaterThan(5);
    expect([...graph.keys()].some((f) => f.includes(`${"main"}/agent/host/`))).toBe(true);
  });

  it("should not import electron anywhere", () => {
    const offenders = [...moduleGraph()]
      .filter(([, specifiers]) => specifiers.some((s) => s === "electron" || s.startsWith("electron/")))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
