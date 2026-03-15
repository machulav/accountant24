import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { getSystemPrompt } from "./system-prompt.js";
import { PROVIDER, MODEL } from "../config.js";

export function createAgent(): Agent {
  return new Agent({
    initialState: {
      systemPrompt: getSystemPrompt(),
      model: (getModel as Function)(PROVIDER, MODEL),
      tools: [],
    },
    streamFn: streamSimple,
  });
}
