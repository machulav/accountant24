// @vitest-environment jsdom

// Spec for the app's one search field: "Search {subject}" placeholder and
// accessible name, magnifier lead-in, and a clear X that exists only while
// there is text, empties the field, and hands focus back to the input. In
// combobox mode the same field binds to a surrounding Base UI Combobox whose
// root controls `inputValue` with the same state.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Combobox } from "@/components/shadcn/combobox";
import { installJsdomPolyfills } from "@/test/jsdomPolyfills";
import { SearchField } from "../search-field";

beforeAll(() => installJsdomPolyfills());
afterEach(() => cleanup());

/** Toolbar-mode harness owning the value like a page does. */
const Toolbar = ({ onChange }: { onChange?: (v: string) => void }) => {
  const [value, setValue] = useState("");
  return (
    <SearchField
      subject="things"
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
};

describe("<SearchField />", () => {
  describe("toolbar mode", () => {
    it("should render a searchbox named after the subject, without a clear button while empty", () => {
      render(<Toolbar />);
      const input = screen.getByRole("searchbox", { name: "Search things" });
      expect(input).toHaveAttribute("placeholder", "Search things");
      expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
    });

    it("should report typed text and clear it from the X, returning focus to the input", async () => {
      const onChange = vi.fn();
      render(<Toolbar onChange={onChange} />);
      const input = screen.getByRole("searchbox", { name: "Search things" });
      await userEvent.type(input, "abc");
      expect(onChange).toHaveBeenLastCalledWith("abc");
      expect(input).toHaveValue("abc");
      await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
      expect(onChange).toHaveBeenLastCalledWith("");
      expect(input).toHaveValue("");
      expect(input).toHaveFocus();
      expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
    });
  });

  describe("combobox mode", () => {
    /** Production wiring: the combobox root controls `inputValue` with the
     *  same state the field receives. */
    const Popup = () => {
      const [query, setQuery] = useState("");
      return (
        <Combobox items={["alpha", "beta"]} inputValue={query} onInputValueChange={setQuery}>
          <SearchField combobox subject="options" value={query} onValueChange={setQuery} />
        </Combobox>
      );
    };

    it("should bind the combobox input and clear typed text from the X without touching focus flow", async () => {
      render(<Popup />);
      const input = screen.getByRole("combobox", { name: "Search options" });
      expect(input).toHaveAttribute("placeholder", "Search options");
      await userEvent.type(input, "alp");
      expect(input).toHaveValue("alp");
      await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
      expect(input).toHaveValue("");
      expect(input).toHaveFocus();
    });
  });
});
