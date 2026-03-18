import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { createTools } from "../tools/index.js";
import { getSystemPrompt } from "./system-prompt.js";

export function createAgent(provider: string, model: string): Agent {
  return new Agent({
    initialState: {
      systemPrompt: getSystemPrompt(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: (getModel as any)(provider, model),
      tools: createTools(),
    },
    streamFn: streamSimple,
  });
}
