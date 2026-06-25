import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type CommitAndPushResult, commitAndPush } from "../git";

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
  promptSnippet: "Commit all changes and push to remote",
  promptGuidelines: [
    "Call commit_and_push after completing a batch of related changes, not after every single tool call.",
    "Give commit_and_push a meaningful commit message summarizing the changes.",
    "Always call commit_and_push at the end of a conversation turn when ledger or memory changes were made.",
  ],
  parameters: Params,

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
};
