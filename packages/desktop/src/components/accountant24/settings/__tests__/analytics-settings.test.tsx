// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/rpc/types";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// IPC boundary: the opt-out reads the stored setting and writes the change back.
const h = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@/rpc/api", () => ({
  settingsApi: { get: h.get, set: h.set },
}));

import { AnalyticsSettings } from "../analytics-settings";

beforeAll(() => {
  installJsdomPolyfills();
});

beforeEach(() => {
  h.get.mockResolvedValue({});
  h.set.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
});

const renderWith = (settings: AppSettings) => {
  h.get.mockResolvedValue(settings);
  render(<AnalyticsSettings />);
};

const toggle = () => screen.findByRole("switch", { name: "Share anonymous analytics" });

describe("AnalyticsSettings — reading the current state", () => {
  it("should default the toggle to on when the setting is absent", async () => {
    renderWith({});
    expect(await toggle()).toBeChecked();
  });

  it("should show the toggle on when analytics is explicitly enabled", async () => {
    renderWith({ analyticsEnabled: true });
    expect(await toggle()).toBeChecked();
  });

  it("should show the toggle off when the user has opted out", async () => {
    renderWith({ analyticsEnabled: false });
    expect(await toggle()).not.toBeChecked();
  });

  it("should not render the toggle until the stored value has loaded", () => {
    h.get.mockReturnValue(new Promise(() => {}));
    render(<AnalyticsSettings />);
    expect(screen.queryByRole("switch")).toBeNull();
    // The section chrome still renders while loading.
    expect(screen.getByText("Analytics")).toBeInTheDocument();
  });

  it("should default the toggle to on when reading the setting fails", async () => {
    h.get.mockRejectedValue(new Error("nope"));
    render(<AnalyticsSettings />);
    expect(await toggle()).toBeChecked();
  });
});

describe("AnalyticsSettings — writing the change", () => {
  it("should opt out when toggled off", async () => {
    renderWith({ analyticsEnabled: true });
    fireEvent.click(await toggle());
    await waitFor(() => expect(h.set).toHaveBeenCalledWith({ analyticsEnabled: false }));
  });

  it("should opt back in when toggled on", async () => {
    renderWith({ analyticsEnabled: false });
    fireEvent.click(await toggle());
    await waitFor(() => expect(h.set).toHaveBeenCalledWith({ analyticsEnabled: true }));
  });

  it("should surface a banner when saving the change fails", async () => {
    h.set.mockRejectedValue(new Error("disk full"));
    renderWith({ analyticsEnabled: true });
    fireEvent.click(await toggle());
    expect(await screen.findByText(/disk full/)).toBeInTheDocument();
  });
});

describe("AnalyticsSettings — data disclosure", () => {
  it("should list what is sent and what is never sent", async () => {
    renderWith({});
    await toggle();
    expect(screen.getByText("App version")).toBeInTheDocument();
    expect(screen.getByText("Anonymous events")).toBeInTheDocument();
    expect(screen.getByText("Your financial data")).toBeInTheDocument();
    expect(screen.getByText("Your IP address")).toBeInTheDocument();
  });
});
