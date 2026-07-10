// @vitest-environment jsdom

import type { ToolCallMessagePartStatus } from "@assistant-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { prettyPrintJson, ToolFallback, toolLabel } from "../tool-fallback";

afterEach(cleanup);

const COMPLETE: ToolCallMessagePartStatus = { type: "complete" };

/** Minimal part props for rendering ToolFallback standalone. */
const partProps = (overrides: Record<string, unknown> = {}) =>
  ({
    type: "tool-call",
    toolCallId: "tc1",
    toolName: "query",
    args: {},
    argsText: '{"report":"bs"}',
    status: COMPLETE,
    ...overrides,
  }) as unknown as React.ComponentProps<typeof ToolFallback>;

const triggerIcon = () => document.querySelector("[data-slot=tool-fallback-trigger-icon]")?.getAttribute("class") ?? "";

describe("toolLabel()", () => {
  describe("pi-extension tool labels", () => {
    it("should return 'Query Ledger' when toolName is 'query'", () => {
      expect(toolLabel("query")).toBe("Query Ledger");
    });

    it("should return 'Add Transactions' when toolName is 'add_transactions'", () => {
      expect(toolLabel("add_transactions")).toBe("Add Transactions");
    });

    it("should return 'Extract Text' when toolName is 'extract_text'", () => {
      expect(toolLabel("extract_text")).toBe("Extract Text");
    });

    it("should return 'Update Memory' when toolName is 'update_memory'", () => {
      expect(toolLabel("update_memory")).toBe("Update Memory");
    });

    it("should return 'Validate Ledger' when toolName is 'validate'", () => {
      expect(toolLabel("validate")).toBe("Validate Ledger");
    });

    it("should return 'Commit & Push' when toolName is 'commit_and_push'", () => {
      expect(toolLabel("commit_and_push")).toBe("Commit & Push");
    });
  });

  describe("fallback for unknown tools", () => {
    it("should capitalize and replace underscores with spaces when toolName is 'fetch_exchange_rates'", () => {
      expect(toolLabel("fetch_exchange_rates")).toBe("Fetch exchange rates");
    });

    it("should replace hyphens with spaces when toolName is 'fetch-rates'", () => {
      expect(toolLabel("fetch-rates")).toBe("Fetch rates");
    });

    it("should capitalize a single word when toolName is 'search'", () => {
      expect(toolLabel("search")).toBe("Search");
    });

    it("should return an empty string when toolName is empty", () => {
      expect(toolLabel("")).toBe("");
    });
  });
});

describe("prettyPrintJson()", () => {
  it("should pretty-print compact JSON objects with 2-space indentation", () => {
    expect(prettyPrintJson('{"report":"bs","end_date":"2026-07-05"}')).toBe(
      '{\n  "report": "bs",\n  "end_date": "2026-07-05"\n}',
    );
  });

  it("should pretty-print nested objects and arrays", () => {
    expect(prettyPrintJson('{"tags":[{"name":"trip"}]}')).toBe(
      '{\n  "tags": [\n    {\n      "name": "trip"\n    }\n  ]\n}',
    );
  });

  it("should pretty-print top-level arrays", () => {
    expect(prettyPrintJson('[{"a":1}]')).toBe('[\n  {\n    "a": 1\n  }\n]');
  });

  it("should return the raw text when JSON is incomplete (still streaming)", () => {
    expect(prettyPrintJson('{"report":"bs","end_')).toBe('{"report":"bs","end_');
  });

  it("should return plain text as-is", () => {
    expect(prettyPrintJson("The ledger is valid.")).toBe("The ledger is valid.");
  });

  it("should return multi-line report text as-is", () => {
    const report = "Balance Sheet 2026-07-04\n\n Assets ||\n";
    expect(prettyPrintJson(report)).toBe(report);
  });

  it("should return scalar JSON as-is", () => {
    expect(prettyPrintJson("123")).toBe("123");
    expect(prettyPrintJson("true")).toBe("true");
    expect(prettyPrintJson("null")).toBe("null");
    expect(prettyPrintJson('"quoted"')).toBe('"quoted"');
  });

  it("should return '{}' when the object is empty", () => {
    expect(prettyPrintJson("{}")).toBe("{}");
  });
});

describe("ToolFallback", () => {
  it("should show the pi tool label and a check icon when the tool completed", () => {
    render(<ToolFallback {...partProps()} />);
    expect(screen.getByText("Query Ledger")).toBeTruthy();
    expect(triggerIcon()).toContain("lucide-check");
  });

  it("should show a plain x icon when the tool returned an error", () => {
    render(<ToolFallback {...partProps({ isError: true, result: "ENOENT" })} />);
    expect(triggerIcon()).toContain("lucide-x");
    expect(triggerIcon()).not.toContain("circle");
  });

  it("should show a spinner while the tool is running, even if isError is not yet known", () => {
    render(<ToolFallback {...partProps({ status: { type: "running" } })} />);
    expect(document.querySelector("[data-slot=tool-fallback-trigger-icon][role=status]")).toBeTruthy();
  });

  it("should show the pretty-printed input under an 'Input:' header when expanded", () => {
    render(<ToolFallback {...partProps({ result: "ok" })} />);
    fireEvent.click(screen.getByText("Query Ledger"));
    expect(screen.getByText("Input:")).toBeTruthy();
    const args = document.querySelector("[data-slot=tool-fallback-args] pre");
    expect(args?.textContent).toBe(`{\n  "report": "bs"\n}`);
  });

  it("should label the result 'Output:' when the tool succeeded", () => {
    render(<ToolFallback {...partProps({ result: "all good" })} />);
    fireEvent.click(screen.getByText("Query Ledger"));
    expect(screen.getByText("Output:")).toBeTruthy();
    expect(screen.getByText("all good")).toBeTruthy();
    expect(screen.queryByText("Error:")).toBeNull();
  });

  it("should label the result 'Error:' when the tool returned an error", () => {
    render(<ToolFallback {...partProps({ isError: true, result: "ENOENT: no such file" })} />);
    fireEvent.click(screen.getByText("Query Ledger"));
    expect(screen.getByText("Error:")).toBeTruthy();
    expect(screen.getByText("ENOENT: no such file")).toBeTruthy();
    expect(screen.queryByText("Output:")).toBeNull();
  });

  it("should strike through the label and hide the result when the tool was cancelled", () => {
    const status: ToolCallMessagePartStatus = { type: "incomplete", reason: "cancelled" };
    render(<ToolFallback {...partProps({ status, result: "partial" })} />);
    const label = screen.getByText("Query Ledger");
    expect(label.parentElement?.className).toContain("line-through");
    fireEvent.click(label);
    expect(screen.queryByText("Output:")).toBeNull();
    expect(screen.queryByText("partial")).toBeNull();
  });

  it("should humanize unknown tool names in the trigger", () => {
    render(<ToolFallback {...partProps({ toolName: "fetch_exchange_rates" })} />);
    expect(screen.getByText("Fetch exchange rates")).toBeTruthy();
  });
});
