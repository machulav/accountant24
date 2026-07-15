// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { ErrorBanner, Section, SettingsRow, SettingsRows } from "../parts";

beforeAll(() => {
  installJsdomPolyfills();
});

afterEach(() => {
  cleanup();
});

describe("Section", () => {
  it("should render the title when given", () => {
    render(
      <Section title="Providers">
        <span>body</span>
      </Section>,
    );
    expect(screen.getByText("Providers")).toBeInTheDocument();
  });

  it("should render the description when given", () => {
    render(
      <Section description="Connect a provider to use its models.">
        <span>body</span>
      </Section>,
    );
    expect(screen.getByText("Connect a provider to use its models.")).toBeInTheDocument();
  });

  it("should render the description even when no title is given", () => {
    // Header shows when title OR description is present; a description-only
    // section must still render its description.
    render(
      <Section description="desc-only">
        <span>body</span>
      </Section>,
    );
    expect(screen.getByText("desc-only")).toBeInTheDocument();
  });

  it("should render the title even when no description is given", () => {
    render(
      <Section title="title-only">
        <span>body</span>
      </Section>,
    );
    expect(screen.getByText("title-only")).toBeInTheDocument();
  });

  it("should render its children", () => {
    render(
      <Section title="Providers" description="desc">
        <span>the-children</span>
      </Section>,
    );
    expect(screen.getByText("the-children")).toBeInTheDocument();
  });

  it("should render children when neither title nor description is given", () => {
    render(
      <Section>
        <span>orphan-child</span>
      </Section>,
    );
    expect(screen.getByText("orphan-child")).toBeInTheDocument();
  });
});

describe("SettingsRows", () => {
  it("should render its children", () => {
    render(
      <SettingsRows>
        <span>row-a</span>
        <span>row-b</span>
      </SettingsRows>,
    );
    expect(screen.getByText("row-a")).toBeInTheDocument();
    expect(screen.getByText("row-b")).toBeInTheDocument();
  });
});

describe("SettingsRow", () => {
  it("should render its children", () => {
    render(
      <SettingsRow>
        <span>row-content</span>
      </SettingsRow>,
    );
    expect(screen.getByText("row-content")).toBeInTheDocument();
  });
});

describe("ErrorBanner", () => {
  it("should render its message", () => {
    render(<ErrorBanner message="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("should expose the message through the alert role", () => {
    render(<ErrorBanner message="Bad API key" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Bad API key");
  });
});
