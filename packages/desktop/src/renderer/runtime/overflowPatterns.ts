// Local copy of pi's context-overflow error detection, for the renderer bundle.
//
// The canonical source is @earendil-works/pi-ai `utils/overflow.ts`
// (`isContextOverflow`), which the pi SDK itself uses to decide whether an
// errored assistant message triggers compact-and-retry. Importing it here would
// drag pi-ai's ~580KB generated model catalog into the renderer bundle (the
// `./base` entry re-exports it and rollup cannot shake it off), so the two
// regex lists are copied verbatim instead. A drift-guard test compares them
// against the installed pi-ai on every run — if pi adds a provider pattern,
// that test fails and this file gets re-synced.
//
// Only the error-message case is replicated: the silent (z.ai) and length-stop
// (MiMo) overflow cases need the model's context window and end in stopReason
// "stop"/"length", which the overflow-recovery interceptor never suppresses.

export const OVERFLOW_PATTERNS: readonly RegExp[] = [
  /prompt is too long/i, // Anthropic token overflow
  /request_too_large/i, // Anthropic request byte-size overflow (HTTP 413)
  /input is too long for requested model/i, // Amazon Bedrock
  /exceeds the context window/i, // OpenAI (Completions & Responses API)
  /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i, // OpenAI-compatible proxies (LiteLLM)
  /input token count.*exceeds the maximum/i, // Google (Gemini)
  /maximum prompt length is \d+/i, // xAI (Grok)
  /reduce the length of the messages/i, // Groq
  /maximum context length is \d+ tokens/i, // OpenRouter (most backends)
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i, // OpenRouter/Poolside
  /input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)/i, // Together AI
  /exceeds the limit of \d+/i, // GitHub Copilot
  /exceeds the available context size/i, // llama.cpp server
  /greater than the context length/i, // LM Studio
  /context window exceeds limit/i, // MiniMax
  /exceeded model token limit/i, // Kimi For Coding
  /too large for model with \d+ maximum context length/i, // Mistral
  /model_context_window_exceeded/i, // z.ai non-standard finish_reason surfaced as error text
  /prompt too long; exceeded (?:max )?context length/i, // Ollama explicit overflow error
  /context[_ ]length[_ ]exceeded/i, // Generic fallback
  /too many tokens/i, // Generic fallback
  /token limit exceeded/i, // Generic fallback
  /^4(?:00|13)\s*(?:status code)?\s*\(no body\)/i, // Cerebras: 400/413 with no body
];

/** Errors that must NOT count as overflow even when an overflow pattern also
 *  matches (e.g. Bedrock throttling: "Too many tokens, please wait…"). */
export const NON_OVERFLOW_PATTERNS: readonly RegExp[] = [
  /^(Throttling error|Service unavailable):/i, // AWS Bedrock non-overflow errors (human-readable prefixes from formatBedrockError)
  /rate limit/i, // Generic rate limiting
  /too many requests/i, // Generic HTTP 429 style
];

/** True when the error text of a `stopReason: "error"` assistant message
 *  indicates a context overflow — mirrors pi-ai's `isContextOverflow` case 1. */
export const isOverflowErrorMessage = (errorMessage: string): boolean =>
  !NON_OVERFLOW_PATTERNS.some((p) => p.test(errorMessage)) && OVERFLOW_PATTERNS.some((p) => p.test(errorMessage));
