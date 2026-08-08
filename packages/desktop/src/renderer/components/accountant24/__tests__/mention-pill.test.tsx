// @vitest-environment jsdom

// Spec for the mention pill's clip-aware tooltip: in truncate mode, hovering
// a pill whose text is actually clipped reveals the full label in the stock
// tooltip; an unclipped pill shows nothing (tooltips on untruncated text are
// noise). jsdom has no layout, so clipping is simulated via the element's
// scrollWidth/clientWidth.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { MentionPill } from "../mentions";

beforeAll(() => {
  installJsdomPolyfills();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(() => cleanup());

const LABEL = "assets:bank:neobank:checking:eur";

const fakeClip = (el: Element, scrollWidth: number, clientWidth: number) => {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
};

describe("<MentionPill /> tooltip", () => {
  it("should reveal the full label on hover when the pill is clipped", async () => {
    render(<MentionPill truncate type="account" label={LABEL} />);
    const pill = screen.getByText(LABEL);
    fakeClip(pill, 250, 150);
    await userEvent.hover(pill);
    // Two matches once open: the pill itself and the tooltip copy.
    await waitFor(() => expect(screen.getAllByText(LABEL).length).toBeGreaterThan(1));
  });

  it("should stay quiet on hover when the pill fits", async () => {
    render(<MentionPill truncate type="account" label={LABEL} />);
    const pill = screen.getByText(LABEL);
    fakeClip(pill, 150, 150);
    await userEvent.hover(pill);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.getAllByText(LABEL)).toHaveLength(1);
  });

  it("should never tooltip outside truncate mode (chat pills wrap instead)", async () => {
    render(<MentionPill type="account" label={LABEL} />);
    const pill = screen.getByText(LABEL);
    fakeClip(pill, 250, 150);
    await userEvent.hover(pill);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.getAllByText(LABEL)).toHaveLength(1);
  });
});
