import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { createTools } from "../tools/index.js";
import { getSystemPrompt, loadSystemPromptContext } from "./system-prompt.js";

export async function createAgent(provider: string, model: string): Promise<Agent> {
  const context = await loadSystemPromptContext();
  return new Agent({
    initialState: {
      systemPrompt: getSystemPrompt(context),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: (getModel as any)(provider, model),
      tools: createTools(),
    },
    streamFn: streamSimple,
  });
}
