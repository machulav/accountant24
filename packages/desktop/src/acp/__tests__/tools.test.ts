import { describe, expect, it } from "vitest";
import { TOOL_LABELS as EXTENSION_LABELS } from "../../../../pi-extension/src/tool-labels";
import { TOOL_LABELS as RENDERER_LABELS } from "../../renderer/lib/tool-labels";
import { EXTENSION_TOOLS, toolKind, toolTitle } from "../tools";

describe("tool label maps", () => {
  // The three copies exist so neither the renderer nor this node-side module
  // imports the agent package. This is the guard that keeps them honest: a tool
  // renamed in one place fails here instead of silently showing a raw name.
  it("should agree across the extension, renderer and ACP copies", () => {
    const acpLabels = Object.fromEntries(Object.entries(EXTENSION_TOOLS).map(([name, t]) => [name, t.label]));
    expect(acpLabels).toEqual(EXTENSION_LABELS);
    expect(RENDERER_LABELS).toEqual(EXTENSION_LABELS);
  });
});

describe("toolTitle()", () => {
  it("should return 'Query Ledger' for query", () => {
    expect(toolTitle("query")).toBe("Query Ledger");
  });

  it("should return 'Commit & Push' for commit_and_push", () => {
    expect(toolTitle("commit_and_push")).toBe("Commit & Push");
  });

  it("should label pi's built-in tools too", () => {
    expect(toolTitle("bash")).toBe("Bash");
    expect(toolTitle("read")).toBe("Read");
  });

  it("should prettify an unknown snake_case name", () => {
    expect(toolTitle("some_new_tool")).toBe("Some new tool");
  });

  it("should prettify an unknown kebab-case name", () => {
    expect(toolTitle("some-new-tool")).toBe("Some new tool");
  });

  it("should return the capitalized name for an unknown single word", () => {
    expect(toolTitle("frobnicate")).toBe("Frobnicate");
  });

  it("should return an empty string for an empty name", () => {
    expect(toolTitle("")).toBe("");
  });
});

describe("toolKind()", () => {
  it("should classify query as search", () => {
    expect(toolKind("query")).toBe("search");
  });

  it("should classify every ledger-writing tool as edit", () => {
    for (const name of ["add_transactions", "add_balance_assertions", "add_prices", "update_memory"]) {
      expect(toolKind(name)).toBe("edit");
    }
  });

  it("should classify extract_text as read", () => {
    expect(toolKind("extract_text")).toBe("read");
  });

  it("should classify validate as think", () => {
    expect(toolKind("validate")).toBe("think");
  });

  it("should classify commit_and_push and bash as execute", () => {
    expect(toolKind("commit_and_push")).toBe("execute");
    expect(toolKind("bash")).toBe("execute");
  });

  it("should fall back to other for an unknown tool", () => {
    expect(toolKind("some_new_tool")).toBe("other");
  });
});
