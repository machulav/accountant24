// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceEntry, MarketplaceResult, PluginInfo } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// IPC boundary: the section reads the index through pluginsApi, and reports
// what it showed through analyticsApi.
const h = vi.hoisted(() => ({
  marketplace: vi.fn<() => Promise<MarketplaceResult>>(),
  track: vi.fn(),
}));

vi.mock("@/rpc/api", () => ({
  pluginsApi: { marketplace: h.marketplace, inspect: vi.fn(), add: vi.fn(), onEvent: vi.fn(async () => () => {}) },
  analyticsApi: { track: h.track, trackOnce: vi.fn() },
}));

import { MarketplaceSection } from "../marketplace-section";

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
});

const entry = (over: Partial<MarketplaceEntry> = {}): MarketplaceEntry => ({
  repo: "acme/budget",
  repoUrl: "https://github.com/acme/budget",
  name: "budget",
  description: "Budget reviews.",
  official: false,
  skills: [{ name: "budget:monthly-review", description: "Reviews the month." }],
  ...over,
});

const served = (plugins: MarketplaceEntry[]): MarketplaceResult => ({
  type: "ok",
  plugins,
  fetchedAt: "2026-08-16T09:00:00.000Z",
});

const plugin = (over: Partial<PluginInfo> = {}): PluginInfo => ({
  name: "budget",
  description: "Budget reviews.",
  skills: [],
  ...over,
});

const onInstalled = vi.fn();

const show = (plugins: PluginInfo[] = []) => render(<MarketplaceSection plugins={plugins} onInstalled={onInstalled} />);

beforeEach(() => {
  onInstalled.mockClear();
  h.track.mockClear();
  h.marketplace.mockResolvedValue(served([entry()]));
});

describe("MarketplaceSection", () => {
  it("should show a loading state until the index arrives", () => {
    h.marketplace.mockReturnValue(new Promise(() => {}));
    show();
    expect(screen.getByText("Loading marketplace…")).toBeTruthy();
  });

  it("should list a published plugin with its description and repository", async () => {
    show();
    expect(await screen.findByText("budget")).toBeTruthy();
    expect(screen.getByText("Budget reviews.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "acme/budget" })).toBeTruthy();
  });

  it("should leave the skills to the confirmation dialog, keeping the rows short", async () => {
    show();
    await screen.findByText("budget");
    expect(screen.queryByText("budget:monthly-review")).toBeNull();
  });

  it("should identify a plugin by its repository alone, which already names the owner", async () => {
    h.marketplace.mockResolvedValue(served([entry({ author: "Ada" })]));
    show();
    expect(await screen.findByRole("link", { name: "acme/budget" })).toBeTruthy();
    expect(screen.queryByText(/Ada/)).toBeNull();
  });

  it("should mark an official plugin as such", async () => {
    h.marketplace.mockResolvedValue(served([entry({ official: true })]));
    show();
    expect(await screen.findByText("Official")).toBeTruthy();
  });

  it("should not mark a community plugin as official", async () => {
    show();
    await screen.findByText("budget");
    expect(screen.queryByText("Official")).toBeNull();
  });

  it("should offer to install a plugin that is not installed yet", async () => {
    show();
    expect(await screen.findByRole("button", { name: "Install" })).not.toHaveProperty("disabled", true);
  });

  it("should open the install dialog on the clicked plugin", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Install plugin?")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "acme/budget" })).toBeTruthy();
  });

  it("should leave out a plugin the app seeded", async () => {
    show([plugin({ source: "accountant24/skills" })]);
    expect(await screen.findByText("Every published plugin is already installed.")).toBeTruthy();
    expect(screen.queryByText("budget")).toBeNull();
  });

  it("should leave out a plugin the user already installed", async () => {
    show([plugin({ source: "acme/budget" })]);
    expect(await screen.findByText("Every published plugin is already installed.")).toBeTruthy();
  });

  it("should keep listing the plugins the user does not have", async () => {
    h.marketplace.mockResolvedValue(served([entry(), entry({ repo: "acme/taxes", name: "taxes" })]));
    show([plugin({ source: "acme/budget" })]);

    expect(await screen.findByText("taxes")).toBeTruthy();
    expect(screen.queryByText("budget")).toBeNull();
  });

  it("should refuse to install a plugin that needs a newer app, and say why next to the button", async () => {
    h.marketplace.mockResolvedValue(served([entry({ minAppVersion: "2.0.0", appTooOld: true })]));
    show();
    expect(await screen.findByRole("button", { name: "Install" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Needs Accountant24 v2.0.0 or newer. Update the app to install it." }),
    ).toBeTruthy();
  });

  it("should say nothing extra about a plugin this app can run", async () => {
    show();
    await screen.findByText("budget");
    expect(screen.queryByRole("button", { name: /Needs Accountant24/ })).toBeNull();
  });

  it("should show the failure and offer another go when the index cannot be read", async () => {
    h.marketplace.mockResolvedValue({ type: "error", message: "Couldn't reach the plugin marketplace." });
    show();
    expect(await screen.findByText("Couldn't reach the plugin marketplace.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("should report a bridge that rejects outright", async () => {
    h.marketplace.mockRejectedValue(new Error("blocked invoke channel"));
    show();
    expect(await screen.findByText("Couldn't load the plugin marketplace.")).toBeTruthy();
  });

  it("should download the index again when another go is asked for", async () => {
    h.marketplace.mockResolvedValue({ type: "error", message: "Couldn't reach the plugin marketplace." });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(h.marketplace).toHaveBeenCalledWith({ force: true }));
  });

  it("should keep the plugins it already listed when a refresh fails", async () => {
    show();
    await screen.findByText("budget");
    h.marketplace.mockResolvedValue({ type: "error", message: "Couldn't reach the plugin marketplace." });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("Couldn't reach the plugin marketplace.")).toBeTruthy();
    expect(screen.getByText("budget")).toBeTruthy();
  });

  it("should read the index once on open, without forcing a download", async () => {
    show();
    await screen.findByText("budget");
    expect(h.marketplace).toHaveBeenCalledTimes(1);
    expect(h.marketplace).toHaveBeenCalledWith({ force: false });
  });

  it("should skip the cache when the list is refreshed", async () => {
    show();
    await screen.findByText("budget");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(h.marketplace).toHaveBeenCalledWith({ force: true }));
  });

  it("should keep the refresh running long enough to be seen when the answer is instant", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show();
      await screen.findByText("budget");

      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await waitFor(() => expect(h.marketplace).toHaveBeenCalledWith({ force: true }));
      // The index is already back, but the button is still showing that it went.
      expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();

      await vi.advanceTimersByTimeAsync(500);
      await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).not.toBeDisabled());
    } finally {
      vi.useRealTimers();
    }
  });

  it("should not hold up the first load, which shows its own loading state", async () => {
    show();
    // No minimum applies here: the list appears as soon as it arrives.
    expect(await screen.findByText("budget")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).not.toBeDisabled();
  });

  it("should refuse a second refresh while one is still running", async () => {
    show();
    await screen.findByText("budget");
    h.marketplace.mockReturnValue(new Promise(() => {}));

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    const refresh = await screen.findByRole("button", { name: "Refresh" });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(h.marketplace).toHaveBeenCalledTimes(2);
  });

  it("should say when nothing has been published yet", async () => {
    h.marketplace.mockResolvedValue(served([]));
    show();
    expect(await screen.findByText("No plugins published yet.")).toBeTruthy();
  });

  it("should filter the list as the search is typed", async () => {
    h.marketplace.mockResolvedValue(served([entry(), entry({ repo: "acme/taxes", name: "taxes" })]));
    show();
    await screen.findByText("budget");

    fireEvent.change(screen.getByLabelText("Search plugins"), { target: { value: "taxes" } });

    expect(screen.getByText("taxes")).toBeTruthy();
    expect(screen.queryByText("budget")).toBeNull();
  });

  it("should say when the search matches nothing", async () => {
    show();
    await screen.findByText("budget");
    fireEvent.change(screen.getByLabelText("Search plugins"), { target: { value: "crypto" } });
    expect(screen.getByText('No plugins match "crypto".')).toBeTruthy();
  });

  it("should count the visit with everything the index published", async () => {
    // Published, not on offer: the count says whether the index arrived
    // populated, which filtering the installed ones out would hide.
    h.marketplace.mockResolvedValue(served([entry(), entry({ repo: "acme/taxes", name: "taxes" })]));
    show([plugin({ name: "budget" })]);

    await waitFor(() => expect(h.track).toHaveBeenCalledWith("marketplace_viewed", { plugin_count: 2 }));
  });

  it("should count one visit however often the list is refreshed", async () => {
    show();
    await screen.findByText("budget");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(h.marketplace).toHaveBeenCalledTimes(2));
    expect(h.track.mock.calls.filter(([event]) => event === "marketplace_viewed")).toHaveLength(1);
  });

  it("should count no visit when the index never arrives", async () => {
    h.marketplace.mockResolvedValue({ type: "error", message: "Couldn't reach the plugin marketplace." });
    show();

    await screen.findByText("Couldn't reach the plugin marketplace.");
    expect(h.track).not.toHaveBeenCalledWith("marketplace_viewed", expect.anything());
  });

  it("should count an install as started when the confirmation opens, not when it lands", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));

    expect(h.track).toHaveBeenCalledWith("plugin_install_started", { official: false });
  });

  it("should mark an install started on one of our own plugins as official", async () => {
    h.marketplace.mockResolvedValue(served([entry({ repo: "accountant24/skills", official: true })]));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));

    expect(h.track).toHaveBeenCalledWith("plugin_install_started", { official: true });
  });

  it("should drop an index that arrives after the section is gone", async () => {
    let resolve: (result: MarketplaceResult) => void = () => {};
    h.marketplace.mockReturnValue(new Promise<MarketplaceResult>((r) => (resolve = r)));
    const { unmount } = show();
    unmount();

    expect(() => resolve(served([entry()]))).not.toThrow();
    await waitFor(() => expect(screen.queryByText("budget")).toBeNull());
  });
});
