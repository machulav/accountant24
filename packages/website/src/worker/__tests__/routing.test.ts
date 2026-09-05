import { describe, expect, it } from "vitest";
import { isDocsPath } from "../routing";

describe("isDocsPath()", () => {
  describe("docs subpath", () => {
    it("should return true for the docs root", () => {
      expect(isDocsPath("/docs")).toBe(true);
    });

    it("should return true for the docs root with a trailing slash", () => {
      expect(isDocsPath("/docs/")).toBe(true);
    });

    it("should return true for a docs page", () => {
      expect(isDocsPath("/docs/quickstart")).toBe(true);
    });

    it("should return true for a nested docs page", () => {
      expect(isDocsPath("/docs/guides/create-a-plugin")).toBe(true);
    });

    it("should return true for the docs llms.txt", () => {
      expect(isDocsPath("/docs/llms.txt")).toBe(true);
    });
  });

  describe("Mintlify infrastructure paths", () => {
    it("should return true for the Mintlify asset bundle", () => {
      expect(isDocsPath("/mintlify-assets/_next/static/chunks/main.js")).toBe(true);
    });

    it("should return true for the Mintlify API playground", () => {
      expect(isDocsPath("/_mintlify/api/request")).toBe(true);
    });

    it("should return true for well-known paths used for domain verification", () => {
      expect(isDocsPath("/.well-known/acme-challenge/token")).toBe(true);
      expect(isDocsPath("/.well-known/vercel/verify")).toBe(true);
    });
  });

  describe("site paths", () => {
    it("should return false for the home page", () => {
      expect(isDocsPath("/")).toBe(false);
    });

    it("should return false for a path that merely starts with the letters 'docs'", () => {
      expect(isDocsPath("/docsx")).toBe(false);
      expect(isDocsPath("/documents")).toBe(false);
      expect(isDocsPath("/docs-old")).toBe(false);
    });

    it("should return false for a legacy root doc URL, which _redirects handles", () => {
      expect(isDocsPath("/quickstart")).toBe(false);
      expect(isDocsPath("/faq")).toBe(false);
    });

    it("should return false for site assets and metadata files", () => {
      expect(isDocsPath("/_astro/index.abc123.css")).toBe(false);
      expect(isDocsPath("/videos/demo.mp4")).toBe(false);
      expect(isDocsPath("/llms.txt")).toBe(false);
      expect(isDocsPath("/sitemap-index.xml")).toBe(false);
      expect(isDocsPath("/robots.txt")).toBe(false);
    });

    it("should return false for a docs-looking path nested under the site", () => {
      expect(isDocsPath("/blog/docs/intro")).toBe(false);
      expect(isDocsPath("/mintlify-assets")).toBe(false);
    });
  });
});
