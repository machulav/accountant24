// ACP prompt content blocks → pi's prompt(text, { images }) arguments.
//
// The spec requires every agent to accept `text` and `resource_link`; we also
// advertise `image` and `embeddedContext`, so `image` and `resource` are handled
// here too. Anything else is ignored rather than rejected, so a client sending a
// block type we do not know cannot fail the whole turn.

import type { ContentBlock } from "@agentclientprotocol/sdk";

/** pi's ImageContent, as accepted by AgentSession.prompt({ images }). */
export interface PiImage {
  type: "image";
  mimeType: string;
  data: string;
}

export interface PiPrompt {
  message: string;
  images: PiImage[];
}

export function toPiPrompt(blocks: ContentBlock[]): PiPrompt {
  const parts: string[] = [];
  const images: PiImage[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "text":
        if (block.text) parts.push(block.text);
        break;

      case "image":
        images.push({ type: "image", mimeType: block.mimeType, data: block.data });
        break;

      // A link to context the client did not inline. The agent cannot fetch it,
      // so pass the URI through as text and let the model ask about it.
      case "resource_link":
        parts.push(`[Context] ${block.uri}`);
        break;

      // Inlined context (an @-mention in Zed, say). Text resources become a
      // fenced block tagged with their URI; binary ones only announce the URI,
      // since pi has no way to consume the blob.
      case "resource": {
        const resource = block.resource;
        if ("text" in resource) {
          parts.push(`[Context] ${resource.uri}\n\`\`\`\n${resource.text}\n\`\`\``);
        } else {
          parts.push(`[Context] ${resource.uri}`);
        }
        break;
      }

      default:
        break;
    }
  }

  return { message: parts.join("\n\n"), images };
}
