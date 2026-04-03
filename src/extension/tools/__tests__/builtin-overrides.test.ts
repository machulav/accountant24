import { describe, expect, mock, test } from "bun:test";
import { initTheme } from "@mariozechner/pi-coding-agent";
import { registerBuiltinOverrides } from "../builtin-overrides";

initTheme();

const mockTheme = { fg: (_c: string, t: string) => t, bold: (t: string) => t } as any;

function makeContext(overrides: Record<string, any> = {}) {
  return {
    lastComponent: undefined,
    executionStarted: true,
    isPartial: false,
    isError: false,
    args: {},
    ...overrides,
  } as any;
}

function createMockPi() {
  const tools = new Map<string, any>();
  return {
    registerTool: mock((tool: any) => tools.set(tool.name, tool)),
    tools,
  };
}

describe("registerBuiltinOverrides()", () => {
  const pi = createMockPi();
  registerBuiltinOverrides(pi as any);

  test("should register 7 built-in tool overrides", () => {
    expect(pi.registerTool).toHaveBeenCalledTimes(7);
    expect(pi.tools.has("read")).toBe(true);
    expect(pi.tools.has("bash")).toBe(true);
    expect(pi.tools.has("edit")).toBe(true);
    expect(pi.tools.has("write")).toBe(true);
    expect(pi.tools.has("grep")).toBe(true);
    expect(pi.tools.has("find")).toBe(true);
    expect(pi.tools.has("ls")).toBe(true);
  });

  describe("renderCall", () => {
    for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
      test(`${name} should show label with expand hint when done`, () => {
        const tool = pi.tools.get(name);
        const component = tool.renderCall({}, mockTheme, makeContext());
        const output = component.render(120).join("\n");
        expect(output).toContain(tool.label);
        expect(output).toContain("ctrl+o to expand");
      });
    }
  });

  describe("renderResult", () => {
    test("read should show File and Content sections", () => {
      const tool = pi.tools.get("read");
      const result = { content: [{ type: "text", text: "file content" }], details: {} };
      const ctx = makeContext({ args: { path: "/test/file.ts" } });
      const component = tool.renderResult(result, { expanded: true, isPartial: false }, mockTheme, ctx);
      const output = component.render(120).join("\n");
      expect(output).toContain("File");
      expect(output).toContain("/test/file.ts");
      expect(output).toContain("Content");
      expect(output).toContain("file content");
    });

    test("bash should show Command and Output sections", () => {
      const tool = pi.tools.get("bash");
      const result = { content: [{ type: "text", text: "hello world" }], details: {} };
      const ctx = makeContext({ args: { command: "echo hello world" } });
      const component = tool.renderResult(result, { expanded: true, isPartial: false }, mockTheme, ctx);
      const output = component.render(120).join("\n");
      expect(output).toContain("Command");
      expect(output).toContain("$ echo hello world");
      expect(output).toContain("Output");
    });

    test("edit should show File and Diff sections", () => {
      const tool = pi.tools.get("edit");
      const result = { content: [{ type: "text", text: "ok" }], details: { diff: "+1 added" } };
      const ctx = makeContext({ args: { path: "/test/file.ts" } });
      const component = tool.renderResult(result, { expanded: true, isPartial: false }, mockTheme, ctx);
      const output = component.render(120).join("\n");
      expect(output).toContain("File");
      expect(output).toContain("/test/file.ts");
      expect(output).toContain("Diff");
    });

    test("write should show File and Content sections", () => {
      const tool = pi.tools.get("write");
      const result = { content: [{ type: "text", text: "written" }], details: {} };
      const ctx = makeContext({ args: { path: "/test/out.ts" } });
      const component = tool.renderResult(result, { expanded: true, isPartial: false }, mockTheme, ctx);
      const output = component.render(120).join("\n");
      expect(output).toContain("File");
      expect(output).toContain("/test/out.ts");
      expect(output).toContain("Content");
    });

    test("grep should show Pattern and Output sections", () => {
      const tool = pi.tools.get("grep");
      const result = { content: [{ type: "text", text: "match" }], details: {} };
      const ctx = makeContext({ args: { pattern: "TODO", path: "src/", glob: "*.ts" } });
      const component = tool.renderResult(result, { expanded: true, isPartial: false }, mockTheme, ctx);
      const output = component.render(120).join("\n");
      expect(output).toContain("Pattern");
      expect(output).toContain("TODO src/");
      expect(output).toContain("--glob *.ts");
      expect(output).toContain("Output");
    });

    test("find should show Pattern and Output sections", () => {
      const tool = pi.tools.get("find");
      const result = { content: [{ type: "text", text: "found.ts" }], details: {} };
      const ctx = makeContext({ args: { pattern: "*.ts", path: "src/" } });
      const component = tool.renderResult(result, { expanded: true, isPartial: false }, mockTheme, ctx);
      const output = component.render(120).join("\n");
      expect(output).toContain("Pattern");
      expect(output).toContain("*.ts src/");
      expect(output).toContain("Output");
    });

    test("ls should show Path and Output sections (label: List)", () => {
      const tool = pi.tools.get("ls");
      const result = { content: [{ type: "text", text: "file1\nfile2" }], details: {} };
      const ctx = makeContext({ args: { path: "/test/dir" } });
      const component = tool.renderResult(result, { expanded: true, isPartial: false }, mockTheme, ctx);
      const output = component.render(120).join("\n");
      expect(output).toContain("Path");
      expect(output).toContain("/test/dir");
      expect(output).toContain("Output");
    });
  });
});
