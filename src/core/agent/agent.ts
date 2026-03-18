import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { createTools } from "../tools/index.js";
import { getSystemPrompt } from "./system-prompt.js";

export function createAgent(provider: string, model: string): Agent {
  return new Agent({
    initialState: {
      systemPrompt: getSystemPrompt(),
      model: (getModel as (...args: never) => unknown)(provider, model),
      tools: createTools(),
    },
    streamFn: streamSimple,
  });
}
