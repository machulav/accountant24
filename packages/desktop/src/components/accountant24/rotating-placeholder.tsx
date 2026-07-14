// Rotating composer placeholder: plain prompt first, then cycle through short
// feature hints so users discover mentions without a cluttered default.

import { useAuiState } from "@assistant-ui/react";
import { LexicalComposerInput } from "@assistant-ui/react-lexical";
import { type ComponentProps, type FC, useEffect, useRef, useState } from "react";
import { useDeleteLineWithChips } from "./use-delete-line-with-chips";

const COMPOSER_PLACEHOLDERS = [
  "Write a message...",
  "Type @ to mention accounts, payees, tags",
  "Type / to use a skill",
];
const PLACEHOLDER_ROTATE_MS = 5000;
// Must match the .aui-lexical-placeholder transition duration in index.css.
const PLACEHOLDER_SWAP_MS = 100;

/** Two-phase swap so the placeholder animates: fade the current text out,
 *  then swap it and let the CSS transition fade the new one back in. */
export const useRotatingPlaceholder = (): { placeholder: string; isSwapping: boolean } => {
  const [index, setIndex] = useState(0);
  const [isSwapping, setIsSwapping] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setIsSwapping(true), PLACEHOLDER_ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!isSwapping) return;
    const id = setTimeout(() => {
      setIndex((i) => (i + 1) % COMPOSER_PLACEHOLDERS.length);
      setIsSwapping(false);
    }, PLACEHOLDER_SWAP_MS);
    return () => clearTimeout(id);
  }, [isSwapping]);

  return { placeholder: COMPOSER_PLACEHOLDERS[index] ?? "Write a message...", isSwapping };
};

type RotatingPlaceholderInputProps = Omit<ComponentProps<typeof LexicalComposerInput>, "placeholder">;

/** LexicalComposerInput with the rotating placeholder. The `display: contents`
 *  wrapper carries data-placeholder-swapping for the swap transition in
 *  index.css without affecting the composer shell's flex layout. */
export const RotatingPlaceholderInput: FC<RotatingPlaceholderInputProps> = (props) => {
  const { placeholder, isSwapping } = useRotatingPlaceholder();
  const editorRef = useRef<HTMLDivElement>(null);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  useDeleteLineWithChips(editorRef);

  // Refocus the input when switching chats (new or existing) so the user can
  // type immediately — the library's autoFocus only covers the initial mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies(mainThreadId): thread switch is the trigger, not an input
  useEffect(() => {
    editorRef.current?.querySelector<HTMLElement>(".aui-lexical-input")?.focus();
  }, [mainThreadId]);

  return (
    <div className="contents" data-placeholder-swapping={isSwapping || undefined}>
      <LexicalComposerInput ref={editorRef} placeholder={placeholder} {...props} />
    </div>
  );
};
