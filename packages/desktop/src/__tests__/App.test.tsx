// @vitest-environment jsdom

// Integration: the top-level gate. App wires useHasModels() -> authApi.status()
// and swaps Onboarding <-> ChatLayout. Real App + real useHasModels + real
// Onboarding over a mocked @/rpc/api boundary; ChatLayout is stubbed (its full
// assistant-ui runtime is out of scope here and covered elsewhere).

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

const status = vi.hoisted(() => vi.fn());
const onModelsChanged = vi.hoisted(() => vi.fn());
const version = vi.hoisted(() => vi.fn().mockResolvedValue("9.9.9"));
vi.mock("@/rpc/api", () => ({
  authApi: { status },
  agentApi: { onModelsChanged },
  appApi: { version },
}));

// Stub the heavy chat layout so the gate is what's under test.
vi.mock("@/components/accountant24/chat-layout", () => ({
  ChatLayout: () => <div data-testid="chat-layout">chat</div>,
}));

import App from "../App";

let modelsChangedCb: (() => void) | null;

beforeAll(() => installJsdomPolyfills());

beforeEach(() => {
  modelsChangedCb = null;
  onModelsChanged.mockImplementation((cb: () => void) => {
    modelsChangedCb = cb;
    return () => {};
  });
});

afterEach(() => cleanup());

const statusWith = (availableModels: number) => ({
  type: "status",
  providers: [],
  availableModels,
  anyConfigured: availableModels > 0,
});

describe("App gate", () => {
  it("should render neither screen while the first model check is pending", () => {
    status.mockReturnValue(new Promise(() => {}));
    const { container } = render(<App />);
    expect(container).toBeEmptyDOMElement();
  });

  it("should show onboarding when no model is available", async () => {
    status.mockResolvedValue(statusWith(0));
    render(<App />);
    await waitFor(() => expect(screen.getByText("Local-first AI agent for personal finance")).toBeInTheDocument());
    expect(screen.queryByTestId("chat-layout")).not.toBeInTheDocument();
  });

  it("should show the chat layout when a model is available", async () => {
    status.mockResolvedValue(statusWith(1));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("chat-layout")).toBeInTheDocument());
  });

  it("should swap onboarding for chat when a model becomes available", async () => {
    status.mockResolvedValue(statusWith(0));
    render(<App />);
    await waitFor(() => expect(screen.getByText("Local-first AI agent for personal finance")).toBeInTheDocument());

    status.mockResolvedValue(statusWith(1));
    modelsChangedCb?.();
    await waitFor(() => expect(screen.getByTestId("chat-layout")).toBeInTheDocument());
  });
});
