import { describe, expect, it } from "vitest";
import { sitemapRoutes, sitemapXml } from "../sitemap";

describe("sitemapRoutes()", () => {
  it("should map the home page to the site root", () => {
    expect(sitemapRoutes(["./index.astro"])).toEqual(["/"]);
  });

  it("should map a top-level page to an extensionless path", () => {
    expect(sitemapRoutes(["./pricing.astro"])).toEqual(["/pricing"]);
  });

  it("should map a nested index to its directory without a trailing slash", () => {
    expect(sitemapRoutes(["./blog/index.astro"])).toEqual(["/blog"]);
  });

  it("should map a nested page to its full path", () => {
    expect(sitemapRoutes(["./blog/launch.astro"])).toEqual(["/blog/launch"]);
  });

  it("should leave out the 404 page", () => {
    expect(sitemapRoutes(["./index.astro", "./404.astro"])).toEqual(["/"]);
  });

  it("should leave out the 500 page", () => {
    expect(sitemapRoutes(["./500.astro"])).toEqual([]);
  });

  it("should leave out a status page nested in a directory", () => {
    expect(sitemapRoutes(["./blog/404.astro"])).toEqual([]);
  });

  it("should leave out a dynamic route", () => {
    expect(sitemapRoutes(["./blog/[slug].astro"])).toEqual([]);
  });

  it("should leave out a rest route", () => {
    expect(sitemapRoutes(["./[...path].astro"])).toEqual([]);
  });

  it("should keep a page whose name merely contains the word index", () => {
    expect(sitemapRoutes(["./indexing.astro"])).toEqual(["/indexing"]);
  });

  it("should sort routes so the output is stable across builds", () => {
    expect(sitemapRoutes(["./pricing.astro", "./about.astro", "./index.astro"])).toEqual(["/", "/about", "/pricing"]);
  });

  it("should list a duplicated key once", () => {
    expect(sitemapRoutes(["./about.astro", "./about.astro"])).toEqual(["/about"]);
  });

  it("should return no routes for no pages", () => {
    expect(sitemapRoutes([])).toEqual([]);
  });
});

describe("sitemapXml()", () => {
  it("should render the home page as an absolute URL with a trailing slash", () => {
    expect(sitemapXml(["/"], "https://accountant24.ai")).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        "  <url><loc>https://accountant24.ai/</loc></url>\n" +
        "</urlset>\n",
    );
  });

  it("should render a sub-page without a trailing slash", () => {
    expect(sitemapXml(["/pricing"], "https://accountant24.ai")).toContain("<loc>https://accountant24.ai/pricing</loc>");
  });

  it("should render one url element per route, in the order given", () => {
    const xml = sitemapXml(["/", "/about"], "https://accountant24.ai");
    expect(xml.match(/<url>/g)).toHaveLength(2);
    expect(xml.indexOf("accountant24.ai/</loc>")).toBeLessThan(xml.indexOf("/about</loc>"));
  });

  it("should escape XML metacharacters in a URL", () => {
    expect(sitemapXml(["/a&b"], "https://accountant24.ai")).toContain("<loc>https://accountant24.ai/a&amp;b</loc>");
  });

  it("should render an empty urlset when there are no routes", () => {
    expect(sitemapXml([], "https://accountant24.ai")).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        "</urlset>\n",
    );
  });

  it("should end with a single trailing newline", () => {
    expect(sitemapXml(["/"], "https://accountant24.ai").endsWith("</urlset>\n")).toBe(true);
  });
});
