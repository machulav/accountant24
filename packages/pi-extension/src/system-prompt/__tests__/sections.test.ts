import { describe, expect, test } from "vitest";
import { buildContextSection, buildToolsSection, patchBakedDate } from "../sections";

// --- patchBakedDate() --------------------------------------------------------

describe("patchBakedDate()", () => {
  test("should replace pi's baked date line with today's date", () => {
    const base = "PROMPT BODY\nCurrent date: 2026-01-01\nCurrent working directory: /home/user";
    expect(patchBakedDate(base, "2026-07-12")).toBe(
      "PROMPT BODY\nCurrent date: 2026-07-12\nCurrent working directory: /home/user",
    );
  });

  test("should leave the rest of the base untouched", () => {
    const base = "<soul>\nAccountant24\n</soul>\nCurrent date: 2025-12-31\nCurrent working directory: /w";
    const patched = patchBakedDate(base, "2026-07-12");
    expect(patched).toContain("<soul>\nAccountant24\n</soul>");
    expect(patched).toContain("Current working directory: /w");
    expect(patched).not.toContain("2025-12-31");
  });

  test("should return the base unchanged when no date line is present (fails soft)", () => {
    const base = "PROMPT BODY without any date footer";
    expect(patchBakedDate(base, "2026-07-12")).toBe(base);
  });

  test("should not touch date-like text that is not at a line start", () => {
    const base = "The value Current date: 2026-01-01 appears mid-line";
    expect(patchBakedDate(base, "2026-07-12")).toBe(base);
  });

  test("should replace only the first matching line when several exist", () => {
    const base = "Current date: 2026-01-01\nbody\nCurrent date: 2026-01-02";
    expect(patchBakedDate(base, "2026-07-12")).toBe("Current date: 2026-07-12\nbody\nCurrent date: 2026-01-02");
  });
});

// --- buildToolsSection() -----------------------------------------------------

describe("buildToolsSection()", () => {
  const tools = [
    { name: "read", snippet: "Read file contents" },
    { name: "query", snippet: "Run hledger reports" },
  ];

  test("should return empty string when there are no tools", () => {
    expect(buildToolsSection([], ["some guideline"])).toBe("");
  });

  test("should list each tool as a name: snippet bullet inside <tools>", () => {
    const section = buildToolsSection(tools, []);
    expect(section).toBe(
      "\n\n<tools>\nAvailable tools:\n- read: Read file contents\n- query: Run hledger reports\n</tools>",
    );
  });

  test("should include a Guidelines block when guidelines are present", () => {
    const section = buildToolsSection(tools, ["Prefer read over cat.", "Validate after edits."]);
    expect(section).toContain("Guidelines:\n- Prefer read over cat.\n- Validate after edits.");
  });

  test("should omit the Guidelines block when guidelines are empty", () => {
    expect(buildToolsSection(tools, [])).not.toContain("Guidelines:");
  });
});

// --- buildContextSection() ---------------------------------------------------

describe("buildContextSection()", () => {
  const empty = { today: "2026-03-19", memory: "", accounts: [], payees: [], tags: [] };

  test("should wrap everything in <context> and include the date", () => {
    const section = buildContextSection(empty);
    expect(section.startsWith("\n\n<context>")).toBe(true);
    expect(section.endsWith("\n\n</context>")).toBe(true);
    expect(section).toContain("<date>\nToday's date: 2026-03-19\n</date>");
  });

  test("should omit the memory block when memory is empty", () => {
    expect(buildContextSection(empty)).not.toContain("<memory>");
  });

  test("should include the memory block when memory has content", () => {
    const section = buildContextSection({ ...empty, memory: "- Rent is $2100" });
    expect(section).toContain("<memory>\n- Rent is $2100\n</memory>");
  });

  test("should render fallback messages for empty accounts, payees, and tags", () => {
    const section = buildContextSection(empty);
    expect(section).toContain("<accounts>\nNo accounts found.\n</accounts>");
    expect(section).toContain("<payees>\nNo payees found.\n</payees>");
    expect(section).toContain("<tags>\nNo tags found.\n</tags>");
  });

  test("should list accounts, payees, and tags when present", () => {
    const section = buildContextSection({
      ...empty,
      accounts: ["Assets:Checking", "Expenses:Rent"],
      payees: ["Whole Foods"],
      tags: ["weekly"],
    });
    expect(section).toContain("<accounts>\nAll known accounts:\nAssets:Checking\nExpenses:Rent\n</accounts>");
    expect(section).toContain("<payees>\nAll known payees:\nWhole Foods\n</payees>");
    expect(section).toContain("<tags>\nAll known tags:\nweekly\n</tags>");
  });
});
