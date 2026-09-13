import type { FeatureDemo } from "../shared/types";

// A composer-only scene: the model picker open on a subscription, an API
// key, and a local Ollama model.
export const modelMenu: FeatureDemo = {
  chatTitle: "New chat",
  composer: {
    models: [
      { name: "Opus 5", note: "Anthropic" },
      { name: "GPT-5", note: "OpenAI" },
      { name: "Llama 3", note: "Ollama (local)" },
    ],
  },
};
