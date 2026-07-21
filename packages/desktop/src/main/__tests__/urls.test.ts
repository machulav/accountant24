import { describe, expect, it } from "vitest";
import { isInternalNavigation, isOpenableExternalUrl, rendererCsp } from "../urls";

describe("isOpenableExternalUrl", () => {
  describe("allowed schemes", () => {
    it("should return true when the url is http", () => {
      expect(isOpenableExternalUrl("http://example.com")).toBe(true);
    });

    it("should return true when the url is https with a path", () => {
      expect(isOpenableExternalUrl("https://example.com/a/b?c=1")).toBe(true);
    });

    it("should return true when the url is mailto", () => {
      expect(isOpenableExternalUrl("mailto:hello@example.com")).toBe(true);
    });

    it("should return true when the scheme is uppercase (URL normalizes it)", () => {
      expect(isOpenableExternalUrl("HTTPS://example.com")).toBe(true);
    });
  });

  describe("refused schemes", () => {
    it("should return false when the url is file", () => {
      expect(isOpenableExternalUrl("file:///Applications/Calculator.app")).toBe(false);
    });

    it("should return false when the url is javascript", () => {
      expect(isOpenableExternalUrl("javascript:alert(1)")).toBe(false);
    });

    it("should return false when the url is a data uri", () => {
      expect(isOpenableExternalUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    });

    it("should return false when the url is an smb share", () => {
      expect(isOpenableExternalUrl("smb://attacker/share")).toBe(false);
    });

    it("should return false when the url is a custom app scheme", () => {
      expect(isOpenableExternalUrl("vscode://file/etc/passwd")).toBe(false);
    });

    it("should return false when the url is tel", () => {
      expect(isOpenableExternalUrl("tel:+1234567890")).toBe(false);
    });
  });

  describe("invalid input", () => {
    it("should return false when the string is not a valid url", () => {
      expect(isOpenableExternalUrl("not a url")).toBe(false);
    });

    it("should return false when the string is a scheme-relative url", () => {
      expect(isOpenableExternalUrl("//evil.com")).toBe(false);
    });

    it("should return false when the string is empty", () => {
      expect(isOpenableExternalUrl("")).toBe(false);
    });
  });
});

describe("isInternalNavigation", () => {
  it("should return true when target and app url share the same http origin", () => {
    expect(isInternalNavigation("http://localhost:5173/chat", "http://localhost:5173/")).toBe(true);
  });

  it("should return false when the target port differs", () => {
    expect(isInternalNavigation("http://localhost:9999/", "http://localhost:5173/")).toBe(false);
  });

  it("should return false when the target host differs", () => {
    expect(isInternalNavigation("http://evil.com/", "http://localhost:5173/")).toBe(false);
  });

  it("should return false when only the scheme differs (https vs http)", () => {
    expect(isInternalNavigation("https://localhost:5173/", "http://localhost:5173/")).toBe(false);
  });

  it("should return true when both target and app url are file urls", () => {
    expect(isInternalNavigation("file:///app/other.html", "file:///app/index.html")).toBe(true);
  });

  it("should return false when navigating from a file app to a remote url", () => {
    expect(isInternalNavigation("http://evil.com/", "file:///app/index.html")).toBe(false);
  });

  it("should return false when the target is not a valid url", () => {
    expect(isInternalNavigation("not a url", "http://localhost:5173/")).toBe(false);
  });

  it("should return false when the app url is not a valid url", () => {
    expect(isInternalNavigation("http://localhost:5173/", "")).toBe(false);
  });
});

describe("rendererCsp", () => {
  it("should default all fetches to the app's own origin", () => {
    expect(rendererCsp()).toContain("default-src 'self'");
  });

  it("should restrict scripts to 'self' with no inline or eval", () => {
    const csp = rendererCsp();
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("should allow inline styles (the UI libraries inject them)", () => {
    expect(rendererCsp()).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("should allow data and blob image sources for attachments", () => {
    expect(rendererCsp()).toContain("img-src 'self' data: blob:");
  });

  it("should forbid plugins, base tag hijacking, and framing", () => {
    const csp = rendererCsp();
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-src 'none'");
  });

  it("should separate directives with semicolons", () => {
    // Each directive must be its own policy, not accidentally concatenated.
    expect(rendererCsp().split("; ").length).toBeGreaterThanOrEqual(8);
  });
});
