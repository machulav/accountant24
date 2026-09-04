// @vitest-environment jsdom

// Spec for the prompt ideas under the New Chat composer: which set shows for
// which ledger size, that a set holds for a visit and the next visit continues
// the stored deck, and that a click only fills and focuses the composer
// (never sends).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// IPC boundary: the composer (rendered alongside, so the focus target exists)
// reads its model picker, @-mentions, and `/` skills over the bridge, and a
// click reports one analytics event over it.
vi.mock("@/rpc/api", () => ({
  ledgerApi: { mentions: vi.fn().mockResolvedValue({ accounts: [], payees: [], tags: [] }) },
  pluginsApi: { list: vi.fn().mockResolvedValue({ plugins: [] }), onEvent: vi.fn(async () => () => {}) },
  settingsApi: {
    get: vi.fn().mockResolvedValue({ enabledModels: [], defaultModel: undefined }),
    onChange: () => () => {},
  },
  agentApi: { onModelsChanged: () => () => {} },
  analyticsApi: { track: vi.fn() },
}));

import {
  AssistantRuntimeProvider,
  type ExternalStoreAdapter,
  useAui,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { PROMPT_IDEA_GROUPS } from "@/lib/promptIdeas";
import { analyticsApi } from "@/rpc/api";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { Composer } from "../composer";
import { PromptIdeas } from "../prompt-ideas";

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/** The aui handle of the rendered runtime, to read and seed composer state
 *  the way the Lexical input would (jsdom cannot type into Lexical). */
let aui: ReturnType<typeof useAui> | undefined;
const CaptureAui = () => {
  aui = useAui();
  return null;
};

/** A real external-store assistant-ui runtime with an empty, idle thread. */
function Chrome({ children }: { children: ReactNode }) {
  const store = {
    messages: [],
    isRunning: false,
    onNew: async () => {},
    convertMessage: (m: unknown) => m,
  } as unknown as ExternalStoreAdapter;
  const runtime = useExternalStoreRuntime(store);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <CaptureAui />
      {children}
    </AssistantRuntimeProvider>
  );
}

const ideaList = () => screen.getByRole("list", { name: "Prompt ideas" });
const ideaButtons = () => within(ideaList()).getAllByRole("button");
const ideaNames = () => ideaButtons().map((b) => b.textContent);
const groupOf = (prompt: string | null) =>
  PROMPT_IDEA_GROUPS.find((group) => group.ideas.some((idea) => idea.prompt === prompt))?.id;
const idOf = (prompt: string | null) =>
  PROMPT_IDEA_GROUPS.flatMap((group) => group.ideas).find((idea) => idea.prompt === prompt)?.id;

describe("<PromptIdeas />", () => {
  describe("which ideas show", () => {
    it("should render nothing while the transaction count is not known yet", () => {
      render(
        <Chrome>
          <PromptIdeas transactionCount={null} />
        </Chrome>,
      );
      expect(screen.queryByRole("list", { name: "Prompt ideas" })).toBeNull();
    });

    it("should show five Getting started ideas for an empty ledger", () => {
      render(
        <Chrome>
          <PromptIdeas transactionCount={0} />
        </Chrome>,
      );
      const names = ideaNames();
      expect(names).toHaveLength(5);
      expect(new Set(names).size).toBe(5);
      for (const name of names) expect(groupOf(name)).toBe("getting-started");
    });

    it("should still show Getting started ideas at exactly 10 transactions", () => {
      render(
        <Chrome>
          <PromptIdeas transactionCount={10} />
        </Chrome>,
      );
      for (const name of ideaNames()) expect(groupOf(name)).toBe("getting-started");
    });

    it("should show one idea from each other group, in group order, once the ledger has 11 transactions", () => {
      render(
        <Chrome>
          <PromptIdeas transactionCount={11} />
        </Chrome>,
      );
      expect(ideaNames().map(groupOf)).toEqual(["ask", "log-and-edit", "rules", "history", "skills"]);
    });

    it("should continue the stored deck on the next visit and persist what is left", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const { unmount } = render(
        <Chrome>
          <PromptIdeas transactionCount={0} />
        </Chrome>,
      );
      expect(ideaNames()[0]).toBe("Import my bank statement");
      expect(JSON.parse(window.localStorage.getItem("accountant24.prompt-idea-decks") ?? "")).toEqual({
        "getting-started": [
          "set-main-currency",
          "what-can-you-do",
          "remember-my-name",
          "get-to-know-me",
          "what-first",
          "starting-balances",
          "record-income",
          "add-credit-card",
          "show-net-worth",
        ],
      });

      unmount();
      render(
        <Chrome>
          <PromptIdeas transactionCount={0} />
        </Chrome>,
      );
      expect(ideaNames()).toEqual([
        "Set my main currency",
        "What can you do?",
        "Remember my name",
        "Ask me a few questions to get to know me",
        "What should I do first?",
      ]);
    });

    it("should keep the same set while the page stays open, even as the count changes below the threshold", () => {
      const random = vi.spyOn(Math, "random").mockReturnValue(0);
      const { rerender } = render(
        <Chrome>
          <PromptIdeas transactionCount={0} />
        </Chrome>,
      );
      const initial = ideaNames();
      expect(initial).toEqual([
        "Import my bank statement",
        "Record spending",
        "Add transactions from a receipt",
        "Set up my accounts",
        "Add a bank account",
      ]);

      random.mockReturnValue(0.999);
      rerender(
        <Chrome>
          <PromptIdeas transactionCount={7} />
        </Chrome>,
      );
      expect(ideaNames()).toEqual(initial);
    });

    it("should pick a fresh set when the count crosses the threshold", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.999);
      const { rerender } = render(
        <Chrome>
          <PromptIdeas transactionCount={10} />
        </Chrome>,
      );
      expect(ideaNames()[0]).toBe("Show my net worth");

      rerender(
        <Chrome>
          <PromptIdeas transactionCount={11} />
        </Chrome>,
      );
      expect(ideaNames()).toEqual([
        "How much do I have in each currency?",
        "Add another account",
        "Ask me a few questions to know me better",
        "What changed this week?",
        "What else can you do?",
      ]);
    });
  });

  describe("clicking an idea", () => {
    const renderWithComposer = () =>
      render(
        <Chrome>
          <Composer />
          <PromptIdeas transactionCount={0} />
        </Chrome>,
      );

    it("should put the idea's text in the composer without sending a message", async () => {
      renderWithComposer();
      const [button] = ideaButtons();
      await userEvent.click(button as HTMLElement);

      expect(aui?.composer().getState().text).toBe(button?.textContent);
      expect(aui?.thread().getState().messages).toHaveLength(0);
    });

    it("should replace a draft already in the composer", async () => {
      renderWithComposer();
      act(() => aui?.composer().setText("half-typed draft"));
      const [button] = ideaButtons();
      await userEvent.click(button as HTMLElement);

      expect(aui?.composer().getState().text).toBe(button?.textContent);
    });

    it("should move focus to the composer input", async () => {
      renderWithComposer();
      const [button] = ideaButtons();
      await userEvent.click(button as HTMLElement);

      await waitFor(() => expect(document.activeElement).toHaveClass("aui-lexical-input"));
    });

    it("should report the idea's id (never its text) as used", async () => {
      renderWithComposer();
      const [button] = ideaButtons();
      await userEvent.click(button as HTMLElement);

      expect(analyticsApi.track).toHaveBeenCalledExactlyOnceWith("prompt_idea_used", {
        idea: idOf(button?.textContent ?? null),
      });
    });

    it("should fill the composer state and leave focus alone when no composer input is on screen", async () => {
      render(
        <Chrome>
          <PromptIdeas transactionCount={0} />
        </Chrome>,
      );
      const [button] = ideaButtons();
      await userEvent.click(button as HTMLElement);

      expect(aui?.composer().getState().text).toBe(button?.textContent);
      await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
      expect(document.activeElement).toBe(button);
    });
  });
});
