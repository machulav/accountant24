import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { getSystemPrompt } from "./system-prompt.js";
import { createTools } from "../tools/index.js";

export function createAgent(provider: string, model: string): Agent {
  return new Agent({
    initialState: {
      systemPrompt: getSystemPrompt(),
      model: (getModel as Function)(provider, model),
      tools: createTools(),
    },
    streamFn: streamSimple,
  });
}
