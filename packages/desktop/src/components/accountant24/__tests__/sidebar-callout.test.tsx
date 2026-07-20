// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StarIcon } from "lucide-react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { SidebarCallout } from "../sidebar-callout";

beforeAll(() => {
  installJsdomPolyfills();
});

afterEach(() => {
  cleanup();
});

describe("SidebarCallout", () => {
  it("should show the title", () => {
    render(<SidebarCallout icon={StarIcon} title="Enjoying the app?" subtitle="Star us on GitHub" />);
    expect(screen.getByText("Enjoying the app?")).toBeInTheDocument();
  });

  it("should show the subtitle", () => {
    render(<SidebarCallout icon={StarIcon} title="Enjoying the app?" subtitle="Star us on GitHub" />);
    expect(screen.getByText("Star us on GitHub")).toBeInTheDocument();
  });

  it("should render as a single button by default", () => {
    render(<SidebarCallout icon={StarIcon} title="Title" subtitle="Subtitle" />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("should call onClick when the block is clicked", () => {
    const onClick = vi.fn();
    render(<SidebarCallout icon={StarIcon} title="Title" subtitle="Subtitle" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("should render as a link carrying the whole content when given an anchor via render", () => {
    render(
      <SidebarCallout
        icon={StarIcon}
        title="Enjoying the app?"
        subtitle="Star us on GitHub"
        // biome-ignore lint/a11y/useAnchorContent: useRender injects the callout content into the anchor at runtime
        render={<a href="https://example.com" />}
      />,
    );
    const link = screen.getByRole("link", { name: /Enjoying the app\?/ });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
