import type { EditToolDetails, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@mariozechner/pi-coding-agent";
import { createRenderCall, createRenderResult } from "./tool-renderer";

function textContent(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.type === "text" ? (result.content[0].text ?? "") : "";
}

export function registerBuiltinOverrides(pi: ExtensionAPI): void {
  const cwd = process.cwd();

  // ── Read ──────────────────────────────────────────────────────────
  const originalRead = createReadTool(cwd);
  pi.registerTool({
    name: originalRead.name,
    label: "Read",
    description: originalRead.description,
    parameters: originalRead.parameters,
    execute: (id, params, signal, onUpdate) => originalRead.execute(id, params, signal, onUpdate),
    renderCall: createRenderCall({ label: "Read" }),
    renderResult: createRenderResult((result, args) => [
      { heading: "File", content: args?.path ?? "" },
      { heading: "Content", content: textContent(result) },
    ]),
  });

  // ── Bash ──────────────────────────────────────────────────────────
  const originalBash = createBashTool(cwd);
  pi.registerTool({
    name: originalBash.name,
    label: "Bash",
    description: originalBash.description,
    parameters: originalBash.parameters,
    execute: (id, params, signal, onUpdate) => originalBash.execute(id, params, signal, onUpdate),
    renderCall: createRenderCall({ label: "Bash" }),
    renderResult: createRenderResult((result, args) => [
      { heading: "Command", content: `$ ${args?.command ?? ""}` },
      { heading: "Output", content: textContent(result) },
    ]),
  });

  // ── Edit ──────────────────────────────────────────────────────────
  const originalEdit = createEditTool(cwd);
  pi.registerTool({
    name: originalEdit.name,
    label: "Edit",
    description: originalEdit.description,
    parameters: originalEdit.parameters,
    execute: (id, params, signal, onUpdate) => originalEdit.execute(id, params, signal, onUpdate),
    renderCall: createRenderCall({ label: "Edit" }),
    renderResult: createRenderResult<EditToolDetails>((result, args) => {
      const diff = result.details?.diff ?? "";
      return [
        { heading: "File", content: args?.path ?? "" },
        ...(diff ? [{ heading: "Diff", content: diff, type: "diff" as const }] : []),
      ];
    }),
  });

  // ── Write ─────────────────────────────────────────────────────────
  const originalWrite = createWriteTool(cwd);
  pi.registerTool({
    name: originalWrite.name,
    label: "Write",
    description: originalWrite.description,
    parameters: originalWrite.parameters,
    execute: (id, params, signal, onUpdate) => originalWrite.execute(id, params, signal, onUpdate),
    renderCall: createRenderCall({ label: "Write" }),
    renderResult: createRenderResult((result, args) => [
      { heading: "File", content: args?.path ?? "" },
      { heading: "Content", content: args?.content ?? textContent(result) },
    ]),
  });

  // ── Grep ──────────────────────────────────────────────────────────
  const originalGrep = createGrepTool(cwd);
  pi.registerTool({
    name: originalGrep.name,
    label: "Grep",
    description: originalGrep.description,
    parameters: originalGrep.parameters,
    execute: (id, params, signal, onUpdate) => originalGrep.execute(id, params, signal, onUpdate),
    renderCall: createRenderCall({ label: "Grep" }),
    renderResult: createRenderResult((result, args) => {
      let pattern = args?.pattern ?? "";
      if (args?.path) pattern += ` ${args.path}`;
      if (args?.glob) pattern += ` --glob ${args.glob}`;
      return [
        { heading: "Pattern", content: pattern },
        { heading: "Output", content: textContent(result) },
      ];
    }),
  });

  // ── Find ──────────────────────────────────────────────────────────
  const originalFind = createFindTool(cwd);
  pi.registerTool({
    name: originalFind.name,
    label: "Find",
    description: originalFind.description,
    parameters: originalFind.parameters,
    execute: (id, params, signal, onUpdate) => originalFind.execute(id, params, signal, onUpdate),
    renderCall: createRenderCall({ label: "Find" }),
    renderResult: createRenderResult((result, args) => {
      let pattern = args?.pattern ?? "";
      if (args?.path) pattern += ` ${args.path}`;
      return [
        { heading: "Pattern", content: pattern },
        { heading: "Output", content: textContent(result) },
      ];
    }),
  });

  // ── List ───────────────────────────────────────────────────────────
  const originalLs = createLsTool(cwd);
  pi.registerTool({
    name: originalLs.name,
    label: "List",
    description: originalLs.description,
    parameters: originalLs.parameters,
    execute: (id, params, signal, onUpdate) => originalLs.execute(id, params, signal, onUpdate),
    renderCall: createRenderCall({ label: "List" }),
    renderResult: createRenderResult((result, args) => [
      { heading: "Path", content: args?.path ?? "." },
      { heading: "Output", content: textContent(result) },
    ]),
  });
}
