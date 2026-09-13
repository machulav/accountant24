// The site's sitemap. @astrojs/sitemap only ever emits a sitemap index plus
// numbered chunk files (it has no flat-file mode), which is ceremony for a
// site of one page, so `/sitemap.xml` is built here: the path crawlers try
// first. The docs are Mintlify's own sitemap under /docs, declared next to
// this one in robots.txt.

/** Pages that are served but never listed: search engines index neither. */
const STATUS_PAGES = new Set(["404", "500"]);

/**
 * The routes to list, from `import.meta.glob` keys for src/pages ("./index.astro").
 * Status pages are left out, and so are dynamic routes, whose params are not
 * knowable from a file name. The rest match the canonical URLs Base.astro
 * emits: "/" for the home page, and "/name" with no trailing slash for the
 * others, which `build.format: "file"` serves without an extension.
 */
export function sitemapRoutes(globKeys: string[]): string[] {
  const routes: string[] = [];
  for (const key of globKeys) {
    const name = key.replace(/^\.\//, "").replace(/\.astro$/, "");
    if (name.includes("[")) continue;
    const segments = name.split("/");
    if (STATUS_PAGES.has(segments[segments.length - 1])) continue;
    if (segments[segments.length - 1] === "index") segments.pop();
    routes.push(`/${segments.join("/")}`);
  }
  return [...new Set(routes)].sort();
}

/** XML-escape a value for a text node. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * `routes` as a sitemap under `siteUrl`. No changefreq or priority, which
 * Google ignores, and no lastmod: it counts only while it stays accurate, and
 * a date stamped on every deploy is worth less than none at all.
 */
export function sitemapXml(routes: string[], siteUrl: string): string {
  const entries = routes.map((route) => `  <url><loc>${escapeXml(new URL(route, siteUrl).href)}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    "</urlset>",
    "",
  ].join("\n");
}
