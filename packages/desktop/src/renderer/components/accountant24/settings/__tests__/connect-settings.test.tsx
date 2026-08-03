// @vitest-environment jsdom
import "../../../../test/jsdomPolyfills";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ acpCommandPath: vi.fn() }));
vi.mock("@/rpc/api", () => ({ appApi: { acpCommandPath: h.acpCommandPath } }));

import { ConnectSettings } from "../connect-settings";

const COMMAND = "/Applications/Accountant24.app/Contents/Resources/accountant24-acp";

beforeEach(() => {
  h.acpCommandPath.mockReset();
  h.acpCommandPath.mockResolvedValue(COMMAND);
});

afterEach(() => {
  cleanup();
});

describe("ConnectSettings", () => {
  it("should show the launcher command once it loads", async () => {
    render(<ConnectSettings />);
    expect(await screen.findByText(COMMAND)).toBeInTheDocument();
  });

  it("should copy the command to the clipboard and confirm", async () => {
    // userEvent installs its own clipboard stub, so read the value back through
    // it rather than spying on a writeText that setup() would replace.
    const user = userEvent.setup();
    render(<ConnectSettings />);
    await user.click(await screen.findByRole("button", { name: "Copy command" }));

    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(COMMAND));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy command" })).toHaveTextContent("Copied"));
  });

  it("should link to the setup guide", async () => {
    render(<ConnectSettings />);
    const link = await screen.findByRole("link", { name: /setup guide/i });
    expect(link).toHaveAttribute("href", "https://accountant24.ai/docs/connect-other-apps");
  });

  it("should render without a command rather than crash when the path cannot be read", async () => {
    h.acpCommandPath.mockRejectedValue(new Error("nope"));
    render(<ConnectSettings />);
    expect(await screen.findByText("Connect other apps")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy command" })).not.toBeInTheDocument();
  });
});
