// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/rpc/api", () => ({
  ledgerApi: { mentions: vi.fn().mockResolvedValue({ accounts: [], payees: [], tags: [] }) },
  skillsApi: { list: vi.fn().mockResolvedValue({ skills: [] }) },
  settingsApi: { get: vi.fn().mockResolvedValue({ enabledModels: [], defaultModel: undefined }), onChange: () => () => {} },
  agentApi: { onModelsChanged: () => () => {} },
}));
import { AssistantRuntimeProvider, type ExternalStoreAdapter, useExternalStoreRuntime } from "@assistant-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { Composer } from "@/components/accountant24/composer";
beforeAll(() => { installJsdomPolyfills(); Element.prototype.hasPointerCapture ??= () => false; Element.prototype.setPointerCapture ??= () => {}; Element.prototype.releasePointerCapture ??= () => {}; });
afterEach(() => cleanup());
const dict = () => ({ listen: () => ({ status: { type: "running" }, stop: async () => {}, cancel: () => {}, onSpeechStart: () => () => {}, onSpeechEnd: () => () => {}, onSpeech: () => () => {} }) });
function Chrome({ children }: any) {
  const store = { messages: [], isRunning: false, onNew: async () => {}, convertMessage: (m: unknown) => m, adapters: { dictation: dict() } } as unknown as ExternalStoreAdapter;
  const runtime = useExternalStoreRuntime(store);
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
describe("dbg", () => {
  it("flips", () => {
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { throw new Error("CONSOLE ERR: " + a.join(" ")); });
    render(<Chrome><Composer /></Chrome>);
    const btn = screen.getByRole("button", { name: "Start voice input" });
    fireEvent.click(btn);
    spy.mockRestore();
    screen.debug(document.body, 100000);
    expect(true).toBe(true);
  });
});
