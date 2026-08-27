import { describe, expect, it } from "vitest";
import { docsReadPages, skillReadName } from "../skill-docs-tool";

describe("skillReadName()", () => {
  it("should return the skill folder name for a read of its SKILL.md", () => {
    expect(skillReadName("read", { path: "/ws/plugins/budget-pro/skills/subscription-audit/SKILL.md" })).toBe(
      "subscription-audit",
    );
  });

  it("should return the folder name for a relative path", () => {
    expect(skillReadName("read", { path: "skills/recurring-spending/SKILL.md" })).toBe("recurring-spending");
  });

  it("should return the folder name for a backslash path", () => {
    expect(skillReadName("read", { path: "C:\\ws\\skills\\recurring-spending\\SKILL.md" })).toBe("recurring-spending");
  });

  it("should return an empty name for a bare SKILL.md with no folder", () => {
    expect(skillReadName("read", { path: "SKILL.md" })).toBe("");
  });

  it("should accept the legacy file_path argument name", () => {
    expect(skillReadName("read", { file_path: "/ws/skills/pdf/SKILL.md" })).toBe("pdf");
  });

  it("should return undefined for reads of other files", () => {
    expect(skillReadName("read", { path: "ledger/main.journal" })).toBeUndefined();
    expect(skillReadName("read", { path: "memory.md" })).toBeUndefined();
  });

  it("should return undefined for a file whose name merely ends in SKILL.md", () => {
    expect(skillReadName("read", { path: "skills/pdf/OLD-SKILL.md" })).toBeUndefined();
  });

  it("should return undefined for a skill's supporting files", () => {
    expect(skillReadName("read", { path: "skills/pdf/reference.md" })).toBeUndefined();
  });

  it("should return undefined for non-read tools even when the path matches", () => {
    expect(skillReadName("edit", { path: "skills/pdf/SKILL.md" })).toBeUndefined();
    expect(skillReadName("write", { path: "skills/pdf/SKILL.md" })).toBeUndefined();
    expect(skillReadName("bash", { command: "cat skills/pdf/SKILL.md" })).toBeUndefined();
  });

  it("should return undefined while args are missing or partial (streaming)", () => {
    expect(skillReadName("read", undefined)).toBeUndefined();
    expect(skillReadName("read", null)).toBeUndefined();
    expect(skillReadName("read", {})).toBeUndefined();
    expect(skillReadName("read", { path: 42 })).toBeUndefined();
  });
});

describe("docsReadPages()", () => {
  describe("read tool", () => {
    it("should return the page name for a page under the packaged macOS docs dir", () => {
      expect(
        docsReadPages("read", { path: "/Applications/Accountant24.app/Contents/Resources/docs/settings.md" }),
      ).toEqual(["settings"]);
    });

    it("should return the page name for a page under the dev docs dir", () => {
      expect(docsReadPages("read", { path: "/repo/packages/desktop/resources/docs/contents.md" })).toEqual([
        "contents",
      ]);
    });

    it("should return the page name for a backslash path under the docs dir", () => {
      expect(docsReadPages("read", { path: "C:\\Accountant24\\resources\\docs\\faq.md" })).toEqual(["faq"]);
    });

    it("should keep a multi-word page name intact", () => {
      expect(docsReadPages("read", { path: "/app/resources/docs/create-a-plugin.md" })).toEqual(["create-a-plugin"]);
    });

    it("should keep a file name without the .md extension as is", () => {
      expect(docsReadPages("read", { path: "/app/resources/docs/README" })).toEqual(["README"]);
    });

    it("should accept the legacy file_path argument name", () => {
      expect(docsReadPages("read", { file_path: "/app/resources/docs/faq.md" })).toEqual(["faq"]);
    });

    it("should return undefined for a skill inside the app resources", () => {
      expect(
        docsReadPages("read", { path: "/app/resources/plugins/accountant24/skills/docs/SKILL.md" }),
      ).toBeUndefined();
    });

    it("should return undefined for a docs folder outside the app resources", () => {
      expect(docsReadPages("read", { path: "/ws/docs/notes.md" })).toBeUndefined();
    });

    it("should return undefined for the docs dir itself with no page", () => {
      expect(docsReadPages("read", { path: "/app/resources/docs" })).toBeUndefined();
      expect(docsReadPages("read", { path: "/app/resources/docs/" })).toBeUndefined();
    });

    it("should return undefined while args are missing or partial (streaming)", () => {
      expect(docsReadPages("read", undefined)).toBeUndefined();
      expect(docsReadPages("read", {})).toBeUndefined();
      expect(docsReadPages("read", { path: 42 })).toBeUndefined();
    });
  });

  describe("bash tool", () => {
    it("should return the page name for a cat of a quoted page via $ACCOUNTANT24_DOCS", () => {
      expect(docsReadPages("bash", { command: 'cat "$ACCOUNTANT24_DOCS/settings.md"' })).toEqual(["settings"]);
    });

    it("should return the page name when the env var is referenced with braces", () => {
      // Assembled so the shell's `${…}` is not read as a template placeholder.
      const command = ["cat $", "{ACCOUNTANT24_DOCS}/contents.md"].join("");
      expect(docsReadPages("bash", { command })).toEqual(["contents"]);
    });

    it("should return the page name for a compound command that also echoes the dir", () => {
      expect(docsReadPages("bash", { command: "echo $ACCOUNTANT24_DOCS; cat $ACCOUNTANT24_DOCS/contents.md" })).toEqual(
        ["contents"],
      );
    });

    it("should return every distinct page when a command reads several", () => {
      expect(
        docsReadPages("bash", {
          command: "cat $ACCOUNTANT24_DOCS/contents.md $ACCOUNTANT24_DOCS/settings.md $ACCOUNTANT24_DOCS/contents.md",
        }),
      ).toEqual(["contents", "settings"]);
    });

    it("should stop the page name at a pipe", () => {
      expect(docsReadPages("bash", { command: "cat $ACCOUNTANT24_DOCS/faq.md|head -20" })).toEqual(["faq"]);
    });

    it("should return an empty list when the docs dir is touched without a page", () => {
      expect(docsReadPages("bash", { command: "echo $ACCOUNTANT24_DOCS" })).toEqual([]);
      expect(docsReadPages("bash", { command: 'ls "$ACCOUNTANT24_DOCS"' })).toEqual([]);
    });

    it("should return undefined when the env var is only mentioned by name", () => {
      expect(docsReadPages("bash", { command: "env | grep ACCOUNTANT24_DOCS" })).toBeUndefined();
    });

    it("should return undefined for a different env var with the same prefix", () => {
      expect(docsReadPages("bash", { command: "echo $ACCOUNTANT24_DOCS_EXTRA" })).toBeUndefined();
      expect(docsReadPages("bash", { command: "echo $ACCOUNTANT24_WORKSPACE" })).toBeUndefined();
    });

    it("should return undefined for unrelated commands", () => {
      expect(docsReadPages("bash", { command: "hledger bal" })).toBeUndefined();
    });

    it("should return undefined while args are missing or partial (streaming)", () => {
      expect(docsReadPages("bash", undefined)).toBeUndefined();
      expect(docsReadPages("bash", {})).toBeUndefined();
      expect(docsReadPages("bash", { command: 42 })).toBeUndefined();
    });
  });

  it("should return undefined for other tools even when the target matches", () => {
    expect(docsReadPages("edit", { path: "/app/resources/docs/faq.md" })).toBeUndefined();
    expect(docsReadPages("query", { command: "cat $ACCOUNTANT24_DOCS/faq.md" })).toBeUndefined();
  });
});
