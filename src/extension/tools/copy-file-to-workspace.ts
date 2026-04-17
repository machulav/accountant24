import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { copyFileToWorkspace } from "../files";
import { createRenderCall, createRenderResult } from "./tool-renderer";

const Params = Type.Object({
  file_path: Type.String({
    description: "Absolute path to the file to copy into the workspace",
  }),
});

const LABEL = "Copy File to the Workspace";

interface CopyResult {
  storedPath: string;
}

export const copyFileToWorkspaceTool: ToolDefinition<typeof Params, CopyResult> = {
  name: "copy_file_to_workspace",
  label: LABEL,
  description:
    "Copy a file into the workspace for safekeeping. Returns the new workspace path of the stored copy. " +
    "Use this path for any subsequent operations on the file.",
  promptSnippet: "Copy a file into the workspace — returns the stored path",
  promptGuidelines: [
    "When the user sends or references an external file, first use copy_file_to_workspace to store it in the workspace, then use the returned path for subsequent operations (extract_text, etc.).",
  ],
  parameters: Params,

  renderCall: createRenderCall({ label: LABEL }),

  async execute(_id, params) {
    const storedPath = await copyFileToWorkspace(params.file_path);

    return {
      content: [{ type: "text" as const, text: storedPath }],
      details: { storedPath },
    };
  },

  renderResult: createRenderResult<CopyResult>(({ details }) => [
    { heading: "Stored", content: details?.storedPath ?? "" },
  ]),
};
