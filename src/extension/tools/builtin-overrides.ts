import type { EditToolDetails, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { ACCOUNTANT24_HOME } from "../config";
import type { ToolPromptMeta } from "../system-prompt";
import { createRenderCall, createRenderResult } from "./tool-renderer";

function textContent(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.type === "text" ? (result.content[0].text ?? "") : "";
}

export function extractMeta(tool: {
  name: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
}): ToolPromptMeta {
  return {
    name: tool.name,
    snippet: tool.promptSnippet ?? tool.name,
    ...(tool.promptGuidelines?.length ? { guidelines: tool.promptGuidelines } : {}),
  };
}

export function registerBuiltinOverrides(pi: ExtensionAPI): ToolPromptMeta[] {
  const cwd = ACCOUNTANT24_HOME;
  const meta: ToolPromptMeta[] = [];

  // ── Read ──────────────────────────────────────────────────────────
  const originalRead = createReadToolDefinition(cwd);
  meta.push(extractMeta(originalRead));
  pi.registerTool({
    name: originalRead.name,
    label: "Read",
    description: originalRead.description,
    parameters: originalRead.parameters,
    execute: (id, params, signal, onUpdate, ctx) => originalRead.execute(id, params, signal, onUpdate, ctx),
    renderCall: createRenderCall({ label: "Read" }),
    renderResult: createRenderResult((result, args) => [
      { heading: "File", content: args?.path ?? "" },
      { heading: "Content", content: textContent(result) },
    ]),
  });

  // ── Bash ──────────────────────────────────────────────────────────
  const originalBash = createBashToolDefinition(cwd);
  meta.push(extractMeta(originalBash));
  pi.registerTool({
    name: originalBash.name,
    label: "Bash",
    description: originalBash.description,
    parameters: originalBash.parameters,
    execute: (id, params, signal, onUpdate, ctx) => originalBash.execute(id, params, signal, onUpdate, ctx),
    renderCall: createRenderCall({ label: "Bash" }),
    renderResult: createRenderResult((result, args) => [
      { heading: "Command", content: `$ ${args?.command ?? ""}` },
      { heading: "Output", content: textContent(result) },
    ]),
  });

  // ── Edit ──────────────────────────────────────────────────────────
  const originalEdit = createEditToolDefinition(cwd);
  meta.push(extractMeta(originalEdit));
  pi.registerTool({
    name: originalEdit.name,
    label: "Edit",
    description: originalEdit.description,
    parameters: originalEdit.parameters,
    execute: (id, params, signal, onUpdate, ctx) => originalEdit.execute(id, params, signal, onUpdate, ctx),
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
  const originalWrite = createWriteToolDefinition(cwd);
  meta.push(extractMeta(originalWrite));
  pi.registerTool({
    name: originalWrite.name,
    label: "Write",
    description: originalWrite.description,
    parameters: originalWrite.parameters,
    execute: (id, params, signal, onUpdate, ctx) => originalWrite.execute(id, params, signal, onUpdate, ctx),
    renderCall: createRenderCall({ label: "Write" }),
    renderResult: createRenderResult((result, args) => [
      { heading: "File", content: args?.path ?? "" },
      { heading: "Content", content: args?.content ?? textContent(result) },
    ]),
  });

  // ── Grep ──────────────────────────────────────────────────────────
  const originalGrep = createGrepToolDefinition(cwd);
  meta.push(extractMeta(originalGrep));
  pi.registerTool({
    name: originalGrep.name,
    label: "Grep",
    description: originalGrep.description,
    parameters: originalGrep.parameters,
    execute: (id, params, signal, onUpdate, ctx) => originalGrep.execute(id, params, signal, onUpdate, ctx),
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
  const originalFind = createFindToolDefinition(cwd);
  meta.push(extractMeta(originalFind));
  pi.registerTool({
    name: originalFind.name,
    label: "Find",
    description: originalFind.description,
    parameters: originalFind.parameters,
    execute: (id, params, signal, onUpdate, ctx) => originalFind.execute(id, params, signal, onUpdate, ctx),
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
  const originalLs = createLsToolDefinition(cwd);
  meta.push(extractMeta(originalLs));
  pi.registerTool({
    name: originalLs.name,
    label: "List",
    description: originalLs.description,
    parameters: originalLs.parameters,
    execute: (id, params, signal, onUpdate, ctx) => originalLs.execute(id, params, signal, onUpdate, ctx),
    renderCall: createRenderCall({ label: "List" }),
    renderResult: createRenderResult((result, args) => [
      { heading: "Path", content: args?.path ?? "." },
      { heading: "Output", content: textContent(result) },
    ]),
  });

  return meta;
}
