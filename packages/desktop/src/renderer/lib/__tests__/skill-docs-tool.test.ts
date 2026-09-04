import { describe, expect, it } from "vitest";
import { isDocsReadCall, skillReadName, skillReadQualifiedName } from "../skill-docs-tool";

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

describe("skillReadQualifiedName()", () => {
  it("should return plugin:skill for a SKILL.md inside a plugin's skills folder", () => {
    expect(
      skillReadQualifiedName("read", { path: "/ws/plugins/accountant24-skills/skills/recurring-spending/SKILL.md" }),
    ).toBe("accountant24-skills:recurring-spending");
  });

  it("should return plugin:skill for a relative plugin path", () => {
    expect(skillReadQualifiedName("read", { path: "plugins/budget-pro/skills/subscription-audit/SKILL.md" })).toBe(
      "budget-pro:subscription-audit",
    );
  });

  it("should return plugin:skill for a backslash plugin path", () => {
    expect(skillReadQualifiedName("read", { path: "C:\\ws\\plugins\\health\\skills\\nutrition\\SKILL.md" })).toBe(
      "health:nutrition",
    );
  });

  it("should return the bare folder name for a SKILL.md outside a plugin", () => {
    expect(skillReadQualifiedName("read", { path: "/ws/skills/pdf/SKILL.md" })).toBe("pdf");
    expect(skillReadQualifiedName("read", { path: "skills/pdf/SKILL.md" })).toBe("pdf");
  });

  it("should return the bare folder name when the layout only resembles a plugin", () => {
    expect(skillReadQualifiedName("read", { path: "/ws/plugins/budget-pro/pdf/SKILL.md" })).toBe("pdf");
    expect(skillReadQualifiedName("read", { path: "/ws/skills/pdf/SKILL.md" })).toBe("pdf");
  });

  it("should return an empty name for a bare SKILL.md with no folder", () => {
    expect(skillReadQualifiedName("read", { path: "SKILL.md" })).toBe("");
  });

  it("should accept the legacy file_path argument name", () => {
    expect(skillReadQualifiedName("read", { file_path: "/ws/plugins/health/skills/nutrition/SKILL.md" })).toBe(
      "health:nutrition",
    );
  });

  it("should return undefined for reads of other files and for non-read tools", () => {
    expect(skillReadQualifiedName("read", { path: "plugins/health/skills/nutrition/README.md" })).toBeUndefined();
    expect(skillReadQualifiedName("edit", { path: "plugins/health/skills/nutrition/SKILL.md" })).toBeUndefined();
  });

  it("should return undefined while args are missing or partial (streaming)", () => {
    expect(skillReadQualifiedName("read", undefined)).toBeUndefined();
    expect(skillReadQualifiedName("read", {})).toBeUndefined();
  });
});

describe("isDocsReadCall()", () => {
  describe("read tool", () => {
    it("should return true for a file under the packaged macOS docs dir", () => {
      expect(
        isDocsReadCall("read", { path: "/Applications/Accountant24.app/Contents/Resources/docs/settings.md" }),
      ).toBe(true);
    });

    it("should return true for a file under the dev docs dir", () => {
      expect(isDocsReadCall("read", { path: "/repo/packages/desktop/resources/docs/contents.md" })).toBe(true);
    });

    it("should return true for a backslash path under the docs dir", () => {
      expect(isDocsReadCall("read", { path: "C:\\Accountant24\\resources\\docs\\faq.md" })).toBe(true);
    });

    it("should accept the legacy file_path argument name", () => {
      expect(isDocsReadCall("read", { file_path: "/app/resources/docs/faq.md" })).toBe(true);
    });

    it("should return false for a skill inside the app resources", () => {
      expect(isDocsReadCall("read", { path: "/app/resources/plugins/accountant24/skills/docs/SKILL.md" })).toBe(false);
    });

    it("should return false for a docs folder outside the app resources", () => {
      expect(isDocsReadCall("read", { path: "/ws/docs/notes.md" })).toBe(false);
    });

    it("should return false for the docs dir itself with no file", () => {
      expect(isDocsReadCall("read", { path: "/app/resources/docs" })).toBe(false);
      expect(isDocsReadCall("read", { path: "/app/resources/docs/" })).toBe(false);
    });

    it("should return false while args are missing or partial (streaming)", () => {
      expect(isDocsReadCall("read", undefined)).toBe(false);
      expect(isDocsReadCall("read", {})).toBe(false);
      expect(isDocsReadCall("read", { path: 42 })).toBe(false);
    });
  });

  describe("bash tool", () => {
    it("should return true for a cat of a file via $ACCOUNTANT24_DOCS", () => {
      expect(isDocsReadCall("bash", { command: 'cat "$ACCOUNTANT24_DOCS/settings.md"' })).toBe(true);
    });

    it("should return true when the env var is referenced with braces", () => {
      // Assembled so the shell's `${…}` is not read as a template placeholder.
      const command = ["cat $", "{ACCOUNTANT24_DOCS}/contents.md"].join("");
      expect(isDocsReadCall("bash", { command })).toBe(true);
    });

    it("should return true for a command that only echoes or lists the docs dir", () => {
      expect(isDocsReadCall("bash", { command: "echo $ACCOUNTANT24_DOCS; ls $ACCOUNTANT24_DOCS" })).toBe(true);
    });

    it("should return false when the env var is only mentioned by name", () => {
      expect(isDocsReadCall("bash", { command: "env | grep ACCOUNTANT24_DOCS" })).toBe(false);
    });

    it("should return false for a different env var with the same prefix", () => {
      expect(isDocsReadCall("bash", { command: "echo $ACCOUNTANT24_DOCS_EXTRA" })).toBe(false);
      expect(isDocsReadCall("bash", { command: "echo $ACCOUNTANT24_WORKSPACE" })).toBe(false);
    });

    it("should return false for unrelated commands", () => {
      expect(isDocsReadCall("bash", { command: "hledger bal" })).toBe(false);
    });

    it("should return false while args are missing or partial (streaming)", () => {
      expect(isDocsReadCall("bash", undefined)).toBe(false);
      expect(isDocsReadCall("bash", {})).toBe(false);
      expect(isDocsReadCall("bash", { command: 42 })).toBe(false);
    });
  });

  it("should return false for other tools even when the target matches", () => {
    expect(isDocsReadCall("edit", { path: "/app/resources/docs/faq.md" })).toBe(false);
    expect(isDocsReadCall("query", { command: "cat $ACCOUNTANT24_DOCS/faq.md" })).toBe(false);
  });
});
