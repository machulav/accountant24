"use client";

import {
  AuiIf,
  groupPartByType,
  MessagePrimitive,
  TextMessagePartProvider,
  ThreadPrimitive,
  type ToolCallMessagePartComponent,
  useAuiState,
} from "@assistant-ui/react";
import { ArrowDownIcon } from "lucide-react";
import { type ComponentType, createContext, type FC, memo, useContext } from "react";
import { UserMessageImage, UserMessageText } from "@/components/accountant24/attachment";
import {
  ChainOfThoughtRoot,
  ChainOfThoughtStep,
  splitReasoningSections,
} from "@/components/accountant24/chain-of-thought";
import { Composer, EditComposer, isNewChatView } from "@/components/accountant24/composer";
import { FinanceOverview } from "@/components/accountant24/dashboard/finance-overview";
import { MarkdownText } from "@/components/accountant24/markdown-text";
import { MessageError } from "@/components/accountant24/message-error";
import { ToolFallback } from "@/components/accountant24/tool-fallback";
import { TooltipIconButton } from "@/components/accountant24/tooltip-icon-button";
import { Bubble, BubbleContent } from "@/components/shadcn/bubble";
import { Message, MessageContent, MessageGroup } from "@/components/shadcn/message";
import { cn } from "@/lib/utils";

/** One reasoning timeline section as standalone markdown. The provider scopes
 *  MarkdownText to the section's slice of the part; `isRunning` keeps the
 *  streaming affordances (smooth reveal, trailing dot) on the last section. */
const ReasoningSection = memo(({ text, isRunning }: { text: string; isRunning: boolean }) => (
  <TextMessagePartProvider text={text} isRunning={isRunning}>
    <MarkdownText />
  </TextMessagePartProvider>
));

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; `ToolFallback` overrides how a tool call
 * renders. Tool UIs registered by name (toolkit `render`, `useAssistantDataUI`)
 * take precedence over `ToolFallback`.
 */
export type ThreadComponents = {
  AssistantMessage?: ComponentType | undefined;
  Welcome?: ComponentType | undefined;
  ToolFallback?: ToolCallMessagePartComponent | undefined;
};

export type ThreadProps = {
  components?: ThreadComponents | undefined;
};

const EMPTY_COMPONENTS: ThreadComponents = {};

const ThreadComponentsContext = createContext<ThreadComponents>(EMPTY_COMPONENTS);

export const Thread: FC<ThreadProps> = ({ components = EMPTY_COMPONENTS }) => {
  const isEmpty = useAuiState(isNewChatView);

  return (
    <ThreadComponentsContext.Provider value={components}>
      <ThreadRoot isEmpty={isEmpty} />
    </ThreadComponentsContext.Provider>
  );
};

const ThreadRoot: FC<{ isEmpty: boolean }> = ({ isEmpty }) => {
  const { Welcome = ThreadWelcome } = useContext(ThreadComponentsContext);

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background @container flex h-full flex-col pt-10"
      style={{ ["--thread-max-width" as string]: "44rem" }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        // scroll-fade-t-6: fade older messages at the top edge (24px). The
        // sticky composer lives inside this container, so no bottom fade. The
        // size is paired with pt-6 on the user-message root: turnAnchor="top"
        // pins that element's box to the edge, so its padding keeps the just
        // sent bubble below the fade zone.
        className="scroll-fade-t scroll-fade-t-6 relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth"
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4",
            // -safe: the finance overview can outgrow small windows; plain
            // center would clip its top edge past the scroll viewport.
            isEmpty && "justify-center-safe",
          )}
        >
          <AuiIf condition={isNewChatView}>
            <Welcome />
          </AuiIf>

          <MessageGroup className="mb-14 gap-6 empty:hidden">
            <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
          </MessageGroup>

          <ThreadPrimitive.ViewportFooter
            className={cn(
              "aui-thread-viewport-footer bg-background flex flex-col gap-4 overflow-visible pb-4 md:pb-6",
              !isEmpty && "sticky bottom-0 mt-auto rounded-t-3xl",
            )}
          >
            <ThreadScrollToBottom />
            <Composer />
          </ThreadPrimitive.ViewportFooter>

          <AuiIf condition={isNewChatView}>
            <FinanceOverview />
          </AuiIf>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const { AssistantMessage: AssistantMessageComponent = AssistantMessage } = useContext(ThreadComponentsContext);
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);

  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessageComponent />;
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col items-center px-4 text-center">
      <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-semibold duration-200">
        How can I help you today?
      </h1>
    </div>
  );
};

const AssistantMessage: FC = () => {
  const { ToolFallback: ToolFallbackComponent = ToolFallback } = useContext(ThreadComponentsContext);

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 animate-in relative duration-150"
    >
      <div
        data-slot="aui_assistant-message-content"
        // [contain-intrinsic-size:auto_24px] fixes issue #4104, don't change without checking for regressions
        className="text-foreground px-2 leading-relaxed wrap-break-word [contain-intrinsic-size:auto_24px] [content-visibility:auto]"
      >
        <MessagePrimitive.GroupedParts
          groupBy={groupPartByType({
            // Reasoning + tool calls share ONE group, so a turn renders as a
            // single ordered chain-of-thought timeline (not per-type collapsibles).
            reasoning: ["group-chainOfThought"],
            "tool-call": ["group-chainOfThought"],
            "standalone-tool-call": [],
          })}
        >
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
                return (
                  <ChainOfThoughtRoot count={part.indices.length} endIndex={part.indices[part.indices.length - 1] ?? 0}>
                    {children}
                  </ChainOfThoughtRoot>
                );
              case "text":
                return <MarkdownText />;
              case "reasoning": {
                // One step (= one rail dot) per summary section. GroupedParts
                // re-renders on every parts update, so a part skipped while
                // empty appears as soon as its text streams in.
                const sections = splitReasoningSections(part.text);
                const running = part.status?.type === "running";
                return sections.map((text, i) => (
                  // Index keys are stable here: sections only grow at the end
                  // while streaming, and never reorder.
                  <ChainOfThoughtStep key={i} variant="reasoning">
                    <ReasoningSection text={text} isRunning={running && i === sections.length - 1} />
                  </ChainOfThoughtStep>
                ));
              }
              case "tool-call":
                return (
                  <ChainOfThoughtStep variant="tool">
                    {part.toolUI ?? <ToolFallbackComponent {...part} />}
                  </ChainOfThoughtStep>
                );
              case "data":
                return part.dataRendererUI;
              case "indicator":
                return (
                  <span
                    role="status"
                    data-slot="aui_assistant-message-indicator"
                    // Pinned system-font stack, not font-sans: Inter draws U+25CF
                    // smaller than the system font, which shrank the dot when the
                    // theme set --font-sans to Inter. Same stack as the in-text
                    // streaming dot (react-markdown dot.css), so the two match.
                    className="animate-pulse [font-family:ui-sans-serif,system-ui,sans-serif]"
                    aria-label="Assistant is working"
                  >
                    {"●"}
                  </span>
                );
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessageError />
      </div>
    </MessagePrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      // pt-6 matches the viewport's scroll-fade-t-6: the top anchor pins this
      // element's box to the viewport edge, so the padding keeps the bubble
      // out of the fade zone right after sending.
      className="fade-in slide-in-from-bottom-1 animate-in px-2 pt-6 duration-150 [contain-intrinsic-size:auto_60px] [content-visibility:auto]"
      data-role="user"
    >
      <Message align="end">
        <MessageContent>
          {/* bg-input/50 (same child-selector pattern as the variant, so it wins
              via tailwind-merge): exactly the composer's surface color, per the
              "user input surfaces look identical" rule. */}
          <Bubble variant="secondary" align="end" className="*:data-[slot=bubble-content]:bg-input/50">
            {/* text-base: conversation content is 16px (composer, assistant
                replies); the stock 14px would shrink the text after sending. */}
            <BubbleContent className="text-base empty:hidden">
              <MessagePrimitive.Parts components={{ Image: UserMessageImage, Text: UserMessageText }} />
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </MessagePrimitive.Root>
  );
};
