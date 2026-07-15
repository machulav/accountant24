// @vitest-environment jsdom

import type { ToolCallMessagePartStatus } from "@assistant-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("should show an alert-circle icon while the tool requires an approval action", () => {
    render(<ToolFallback {...partProps({ status: { type: "requires-action" } })} />);
    expect(triggerIcon()).toContain("lucide-circle-alert");
  });

  it("should pretty-print a non-string (object) result as indented JSON", () => {
    render(<ToolFallback {...partProps({ result: { balance: 100, currency: "EUR" } })} />);
    fireEvent.click(screen.getByText("Query Ledger"));
    const output = document.querySelector("[data-slot=tool-fallback-result] pre");
    expect(output?.textContent).toBe(`{\n  "balance": 100,\n  "currency": "EUR"\n}`);
  });

  it("should not render an input section when the tool has no argsText", () => {
    render(<ToolFallback {...partProps({ argsText: undefined, result: "ok" })} />);
    fireEvent.click(screen.getByText("Query Ledger"));
    expect(screen.queryByText("Input:")).toBeNull();
  });

  it("should not render a result section when the tool has no result yet", () => {
    render(<ToolFallback {...partProps({ result: undefined })} />);
    fireEvent.click(screen.getByText("Query Ledger"));
    expect(screen.queryByText("Output:")).toBeNull();
    expect(screen.queryByText("Error:")).toBeNull();
  });
});

describe("ToolFallback expand/collapse", () => {
  const trigger = () => screen.getByRole("button", { name: /Query Ledger/ });

  it("should start collapsed with the details hidden", () => {
    render(<ToolFallback {...partProps({ result: "ok" })} />);
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Output:")).toBeNull();
  });

  it("should reveal the details when the trigger is clicked", () => {
    render(<ToolFallback {...partProps({ result: "ok" })} />);
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Output:")).toBeTruthy();
  });

  it("should collapse again when the open trigger is clicked a second time", () => {
    render(<ToolFallback {...partProps({ result: "ok" })} />);
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("should start expanded when the tool requires an approval action", () => {
    render(<ToolFallback {...partProps({ status: { type: "requires-action" } })} />);
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
  });
});

describe("ToolFallback error details", () => {
  it("should render an 'Error:' header and the error text for a failed (incomplete) run", () => {
    const status: ToolCallMessagePartStatus = {
      type: "incomplete",
      // reason narrows in the union; only "cancelled" changes the header wording.
      error: "boom",
    } as ToolCallMessagePartStatus;
    render(<ToolFallback {...partProps({ status })} />);
    fireEvent.click(screen.getByText("Query Ledger"));
    const errorBox = document.querySelector("[data-slot=tool-fallback-error]");
    expect(errorBox?.textContent).toContain("Error:");
    expect(errorBox?.textContent).toContain("boom");
  });

  it("should stringify a non-string error object", () => {
    const status = { type: "incomplete", error: { code: 500 } } as unknown as ToolCallMessagePartStatus;
    render(<ToolFallback {...partProps({ status })} />);
    fireEvent.click(screen.getByText("Query Ledger"));
    const errorBox = document.querySelector("[data-slot=tool-fallback-error]");
    expect(errorBox?.textContent).toContain('{"code":500}');
  });

  it("should label the error box 'Cancelled reason:' when the run was cancelled", () => {
    const status: ToolCallMessagePartStatus = {
      type: "incomplete",
      reason: "cancelled",
      error: "user aborted",
    } as ToolCallMessagePartStatus;
    render(<ToolFallback {...partProps({ status })} />);
    fireEvent.click(screen.getByText("Query Ledger"));
    const errorBox = document.querySelector("[data-slot=tool-fallback-error]");
    expect(errorBox?.textContent).toContain("Cancelled reason:");
    expect(errorBox?.textContent).toContain("user aborted");
  });

  it("should not render an error box when an incomplete run carries no error", () => {
    const status: ToolCallMessagePartStatus = { type: "incomplete", reason: "cancelled" };
    render(<ToolFallback {...partProps({ status, result: "partial" })} />);
    fireEvent.click(screen.getByText("Query Ledger"));
    expect(document.querySelector("[data-slot=tool-fallback-error]")).toBeNull();
  });
});

describe("ToolFallback approval bar", () => {
  const REQUIRES_ACTION: ToolCallMessagePartStatus = { type: "requires-action", reason: "interrupt" };

  it("should resolve with the approved result when the default Allow button is clicked", () => {
    const addResult = vi.fn();
    render(<ToolFallback {...partProps({ status: REQUIRES_ACTION, addResult })} />);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(addResult).toHaveBeenCalledWith("Approved by user");
  });

  it("should resolve with the denied result when the default Deny button is clicked", () => {
    const addResult = vi.fn();
    render(<ToolFallback {...partProps({ status: REQUIRES_ACTION, addResult })} />);
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(addResult).toHaveBeenCalledWith("User denied tool execution");
  });

  it("should ignore a second click after the approval has been submitted", () => {
    const addResult = vi.fn();
    render(<ToolFallback {...partProps({ status: REQUIRES_ACTION, addResult })} />);
    const allow = screen.getByRole("button", { name: "Allow" });
    fireEvent.click(allow);
    fireEvent.click(allow);
    expect(addResult).toHaveBeenCalledTimes(1);
  });

  it("should render the host's declared options and respond with the chosen option id", () => {
    const respondToApproval = vi.fn();
    const approval = {
      options: [
        { id: "opt-allow", kind: "allow-once" },
        { id: "opt-reject", kind: "reject-once" },
      ],
    };
    render(<ToolFallback {...partProps({ status: REQUIRES_ACTION, approval, respondToApproval })} />);
    // Default labels map allow-once -> "Allow", reject-once -> "Deny".
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(respondToApproval).toHaveBeenCalledWith({ optionId: "opt-allow" });
  });

  it("should prefer an option's explicit label over the default", () => {
    const respondToApproval = vi.fn();
    const approval = {
      options: [
        { id: "opt-allow", kind: "allow-once", label: "Grant access" },
        { id: "opt-reject", kind: "reject-once" },
      ],
    };
    render(<ToolFallback {...partProps({ status: REQUIRES_ACTION, approval, respondToApproval })} />);
    expect(screen.getByRole("button", { name: "Grant access" })).toBeInTheDocument();
  });

  it("should require a confirmation step before responding to a confirm-guarded option", () => {
    const respondToApproval = vi.fn();
    const approval = {
      options: [
        { id: "opt-always", kind: "allow-always", label: "Always allow", confirm: true },
        { id: "opt-reject", kind: "reject-once" },
      ],
    };
    render(<ToolFallback {...partProps({ status: REQUIRES_ACTION, approval, respondToApproval })} />);
    fireEvent.click(screen.getByRole("button", { name: "Always allow" }));
    // A confirm step opens instead of resolving immediately.
    expect(respondToApproval).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(respondToApproval).toHaveBeenCalledWith({ optionId: "opt-always" });
  });

  it("should return to the option list without responding when Back is clicked in the confirm step", () => {
    const respondToApproval = vi.fn();
    const approval = {
      options: [
        { id: "opt-always", kind: "allow-always", label: "Always allow", confirm: true },
        { id: "opt-reject", kind: "reject-once" },
      ],
    };
    render(<ToolFallback {...partProps({ status: REQUIRES_ACTION, approval, respondToApproval })} />);
    fireEvent.click(screen.getByRole("button", { name: "Always allow" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(respondToApproval).not.toHaveBeenCalled();
    // Back on the option list — the original options are shown again.
    expect(screen.getByRole("button", { name: "Always allow" })).toBeInTheDocument();
  });

  it("should not render an approval bar once the approval has been resolved", () => {
    const approval = { approved: true, options: [{ id: "opt-allow", kind: "allow-once" }] };
    render(<ToolFallback {...partProps({ status: REQUIRES_ACTION, approval, respondToApproval: vi.fn() })} />);
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
  });

  it("should always offer a refusal path even when the host declares only allow options", () => {
    const respondToApproval = vi.fn();
    const approval = { options: [{ id: "opt-allow", kind: "allow-once" }] };
    render(<ToolFallback {...partProps({ status: REQUIRES_ACTION, approval, respondToApproval })} />);
    // No reject option declared, so a fallback Deny is added.
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(respondToApproval).toHaveBeenCalledWith({ approved: false });
  });

  it("should auto-expand when a running tool transitions into requiring an approval action", () => {
    const { rerender } = render(<ToolFallback {...partProps({ status: { type: "running" } })} />);
    const trigger = () => screen.getByRole("button", { name: /Query Ledger/ });
    expect(trigger()).toHaveAttribute("aria-expanded", "false");

    rerender(<ToolFallback {...partProps({ status: REQUIRES_ACTION })} />);
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
  });
});
