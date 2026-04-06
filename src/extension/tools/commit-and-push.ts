import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { type CommitAndPushResult, commitAndPush } from "../git";
import { createRenderCall, createRenderResult } from "./tool-renderer";

const Params = Type.Object({
  message: Type.String({
    description: "A concise, meaningful commit message describing what was changed and why.",
  }),
});

const LABEL = "Commit & Push";

export const commitAndPushTool: ToolDefinition<typeof Params, CommitAndPushResult> = {
  name: "commit_and_push",
  label: LABEL,
  description:
    "Stage all changes, commit with the provided message, and push to the remote if one is configured. " +
    "Returns the list of committed files and whether a push occurred.",
  promptSnippet: "commit_and_push — commit all changes and push to remote",
  promptGuidelines: [
    "Call commit_and_push after completing a batch of related changes (adding transactions, editing the ledger, updating memory).",
    "Write a meaningful commit message summarizing the changes.",
    "Do not call commit_and_push after every single tool call — batch related changes into one commit.",
    "Always call commit_and_push at the end of a conversation turn when ledger or memory changes were made.",
  ],
  parameters: Params,

  renderCall: createRenderCall({ label: LABEL }),

  async execute(_id, params) {
    const result = await commitAndPush(params.message);

    if (result.status === "no_changes") {
      return {
        content: [{ type: "text", text: "No changes to commit." }],
        details: result,
      };
    }

    const lines = [`Committed: ${result.commitMessage}`];
    lines.push(`Files: ${result.committedFiles.join(", ")}`);
    lines.push(result.pushed ? "Pushed to remote." : "No remote configured; changes are local only.");

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: result,
    };
  },

  renderResult: createRenderResult<CommitAndPushResult>(({ details }) => {
    if (details?.status === "no_changes") {
      return [{ heading: "", content: "No changes to commit." }];
    }
    const sections = [
      { heading: "Message", content: details?.commitMessage ?? "" },
      { heading: "Files", content: details?.committedFiles?.join("\n") ?? "" },
    ];
    if (details?.pushed) {
      sections.push({ heading: "Remote", content: "Pushed to remote." });
    }
    return sections;
  }),
};
