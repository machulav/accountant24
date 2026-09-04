// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";

// IPC boundary: clicking the banner quits + applies the staged update over the
// Electron bridge. Only `install` is exercised here.
const install = vi.fn();
vi.mock("@/rpc/api", () => ({
  updateApi: { install: () => install() },
}));

import { UpdateBanner } from "../update-banner";

beforeAll(() => {
  installJsdomPolyfills();
});

afterEach(() => {
  cleanup();
});

describe("UpdateBanner", () => {
  it("should announce that an update is available", () => {
    render(<UpdateBanner version="1.2.3" />);
    expect(screen.getByText("Update available")).toBeInTheDocument();
  });

  it("should invite the user to relaunch to install the staged version", () => {
    render(<UpdateBanner version="1.2.3" />);
    expect(screen.getByText("Relaunch to install v1.2.3")).toBeInTheDocument();
  });

  it("should render the version straight from its prop, not a fixed value", () => {
    render(<UpdateBanner version="9.9.0-beta.4" />);
    expect(screen.getByText("Relaunch to install v9.9.0-beta.4")).toBeInTheDocument();
  });

  it("should expose the banner as a single clickable button", () => {
    render(<UpdateBanner version="1.2.3" />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("should apply the staged update when clicked", () => {
    render(<UpdateBanner version="1.2.3" />);
    fireEvent.click(screen.getByRole("button"));
    expect(install).toHaveBeenCalledOnce();
  });

  it("should not apply the update until the user clicks", () => {
    render(<UpdateBanner version="1.2.3" />);
    expect(install).not.toHaveBeenCalled();
  });
});
