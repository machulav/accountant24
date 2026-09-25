import { describe, expect, it } from "vitest";
import { mintlifyPath } from "../routing";

describe("mintlifyPath()", () => {
  describe("docs subpath", () => {
    it("should keep the docs root", () => {
      expect(mintlifyPath("/docs")).toBe("/docs");
    });

    it("should keep the docs root with a trailing slash", () => {
      expect(mintlifyPath("/docs/")).toBe("/docs/");
    });

    it("should keep a docs page", () => {
      expect(mintlifyPath("/docs/quickstart")).toBe("/docs/quickstart");
    });

    it("should keep a nested docs page", () => {
      expect(mintlifyPath("/docs/guides/create-a-plugin")).toBe("/docs/guides/create-a-plugin");
    });

    it("should keep the docs llms files where Mintlify serves them", () => {
      expect(mintlifyPath("/docs/llms.txt")).toBe("/docs/llms.txt");
      expect(mintlifyPath("/docs/llms-full.txt")).toBe("/docs/llms-full.txt");
    });
  });

  describe("Mintlify infrastructure paths", () => {
    it("should keep the Mintlify asset bundle", () => {
      expect(mintlifyPath("/mintlify-assets/_next/static/chunks/main.js")).toBe(
        "/mintlify-assets/_next/static/chunks/main.js",
      );
    });

    it("should keep the Mintlify API playground", () => {
      expect(mintlifyPath("/_mintlify/api/request")).toBe("/_mintlify/api/request");
    });

    it("should keep well-known paths used for domain verification", () => {
      expect(mintlifyPath("/.well-known/acme-challenge/token")).toBe("/.well-known/acme-challenge/token");
      expect(mintlifyPath("/.well-known/vercel/verify")).toBe("/.well-known/vercel/verify");
    });
  });

  describe("root files Mintlify generates under /docs", () => {
    it("should map the root llms.txt to the docs one", () => {
      expect(mintlifyPath("/llms.txt")).toBe("/docs/llms.txt");
    });

    it("should map the root llms-full.txt to the docs one", () => {
      expect(mintlifyPath("/llms-full.txt")).toBe("/docs/llms-full.txt");
    });

    it("should not map a near miss of a root file name", () => {
      expect(mintlifyPath("/llms.txt/")).toBeUndefined();
      expect(mintlifyPath("/llms-full.txtx")).toBeUndefined();
      expect(mintlifyPath("/x/llms.txt")).toBeUndefined();
      expect(mintlifyPath("/LLMS.txt")).toBeUndefined();
    });
  });

  describe("site paths", () => {
    it("should return undefined for the home page", () => {
      expect(mintlifyPath("/")).toBeUndefined();
    });

    it("should return undefined for a path that merely starts with the letters 'docs'", () => {
      expect(mintlifyPath("/docsx")).toBeUndefined();
      expect(mintlifyPath("/documents")).toBeUndefined();
      expect(mintlifyPath("/docs-old")).toBeUndefined();
    });

    it("should return undefined for a legacy root doc URL, which _redirects handles", () => {
      expect(mintlifyPath("/quickstart")).toBeUndefined();
      expect(mintlifyPath("/faq")).toBeUndefined();
    });

    it("should return undefined for site assets and metadata files", () => {
      expect(mintlifyPath("/_astro/index.abc123.css")).toBeUndefined();
      expect(mintlifyPath("/videos/demo.mp4")).toBeUndefined();
      expect(mintlifyPath("/sitemap.xml")).toBeUndefined();
      expect(mintlifyPath("/robots.txt")).toBeUndefined();
    });

    it("should return undefined for a docs-looking path nested under the site", () => {
      expect(mintlifyPath("/blog/docs/intro")).toBeUndefined();
      expect(mintlifyPath("/mintlify-assets")).toBeUndefined();
    });
  });
});
