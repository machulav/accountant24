// @vitest-environment jsdom

// Installing a plugin from the marketplace, over the real rpc layer and a fake
// IPC bridge: the section lists what main published, the install runs the same
// inspect/confirm/add steps a hand-typed repository does, and the agent is
// restarted so the new skills reach the composer.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceResult, PluginsList } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// rpc/api.ts captures `window.api` at module load — install the fake bridge
// before any import pulls it in (async vi.hoisted runs before the imports).
const bridge = await vi.hoisted(async () => (await import("@/test/fakeApi")).installFakeApi());

import { PluginsSettings } from "../plugins-settings";

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
  bridge.reset();
});

const PUBLISHED: MarketplaceResult = {
  type: "ok",
  fetchedAt: "2026-08-16T09:00:00.000Z",
  plugins: [
    {
      repo: "accountant24/skills",
      repoUrl: "https://github.com/accountant24/skills",
      name: "accountant24-skills",
      description: "The skills that come with the app.",
      official: true,
      skills: [{ name: "accountant24-skills:subscription-audit", description: "Review subscriptions." }],
    },
    {
      repo: "acme/pdf-tools",
      repoUrl: "https://github.com/acme/pdf-tools",
      name: "pdf-tools",
      description: "Work with PDFs.",
      author: "Acme Inc.",
      official: false,
      skills: [{ name: "pdf-tools:pdf", description: "Read, split, and OCR PDFs." }],
    },
  ],
};

/** The workspace before the install: only the plugin the app seeded. */
const BEFORE: PluginsList = {
  plugins: [
    {
      name: "accountant24-skills",
      description: "The skills that come with the app.",
      source: "accountant24/skills",
      skills: [{ name: "accountant24-skills:subscription-audit", description: "Review subscriptions." }],
    },
  ],
};

/** ...and after it, with the installed plugin switched on. */
const AFTER: PluginsList = {
  plugins: [
    ...BEFORE.plugins,
    {
      name: "pdf-tools",
      description: "Work with PDFs.",
      source: "acme/pdf-tools",
      skills: [{ name: "pdf-tools:pdf", description: "Read, split, and OCR PDFs." }],
    },
  ],
};

beforeEach(() => {
  let installed = false;
  bridge.setHandler("plugins_list", () => (installed ? AFTER : BEFORE));
  bridge.setHandler("plugins_marketplace", () => PUBLISHED);
  bridge.setHandler("plugins_inspect", () => ({
    type: "plugin",
    plugin: {
      name: "pdf-tools",
      description: "Work with PDFs.",
      author: "Acme Inc.",
      repo: "acme/pdf-tools",
      repoUrl: "https://github.com/acme/pdf-tools",
      skills: [{ name: "pdf-tools:pdf", description: "Read, split, and OCR PDFs." }],
    },
  }));
  bridge.setHandler("plugins_add", () => {
    installed = true;
    return { type: "done", name: "pdf-tools" };
  });
  bridge.setHandler("agent_restart", () => undefined);
  bridge.setHandler("analytics_track", () => undefined);
});

/** The analytics events that crossed the bridge, in order. */
const tracked = () =>
  bridge.callsFor("analytics_track").map((payload) => payload as { event: string; props?: unknown });

describe("installing a plugin from the marketplace", () => {
  it("should install the plugin the user picked, ready to use", async () => {
    render(<PluginsSettings />);

    // The seeded plugin is already in the Installed list, so the marketplace
    // offers only the other one.
    expect(await screen.findByRole("button", { name: "Install" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Install" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    // The confirmation is the marketplace's own data: nothing is fetched yet.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Not reviewed by Accountant24");
    expect(within(dialog).getByRole("link", { name: "acme/pdf-tools" })).toBeInTheDocument();
    expect(bridge.callsFor("plugins_inspect")).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Install" }));

    // Reading the repository and copying it in happen on confirm, then the
    // agent is restarted so its skill set matches and the lists reload.
    await waitFor(() => expect(bridge.callsFor("agent_restart")).toHaveLength(1));
    expect(bridge.callsFor("plugins_inspect")).toEqual([{ source: "acme/pdf-tools" }]);
    expect(bridge.callsFor("plugins_add")).toEqual([undefined]);
    expect(
      bridge.calls.map((c) => c.channel).filter((c) => c !== "plugins_marketplace" && c !== "analytics_track"),
    ).toEqual(["plugins_list", "plugins_inspect", "plugins_add", "agent_restart", "plugins_list"]);

    // The funnel, end to end: the list was seen, one install was started, and
    // the install itself is counted in main (plugins_add), not here.
    expect(tracked()).toEqual([
      { event: "marketplace_viewed", props: { plugin_count: 2 } },
      { event: "plugin_install_started", props: { official: false } },
    ]);

    // The plugin now sits under Installed, ready to use, alongside the seeded
    // one...
    expect(await screen.findAllByRole("button", { name: "Uninstall" })).toHaveLength(2);
    // ...and the marketplace no longer offers it.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Install" })).toBeNull());
    expect(screen.getByText("Every published plugin is already installed.")).toBeTruthy();
  });

  it("should leave the workspace untouched when the user cancels the confirmation", async () => {
    render(<PluginsSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(bridge.callsFor("plugins_add")).toEqual([]);
    expect(bridge.callsFor("agent_restart")).toEqual([]);
    // The started install is still counted, with no install to match it: an
    // abandoned confirmation is the number the warning is judged by.
    expect(tracked().map((e) => e.event)).toEqual(["marketplace_viewed", "plugin_install_started"]);
  });
});
