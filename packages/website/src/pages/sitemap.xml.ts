import type { APIRoute } from "astro";
import { site } from "../content/site";
import { sitemapRoutes, sitemapXml } from "../lib/sitemap";

// Every page next to this one; only the keys are read, so no page is loaded.
const pages = import.meta.glob("./**/*.astro");

export const GET: APIRoute = () =>
  new Response(sitemapXml(sitemapRoutes(Object.keys(pages)), site.url), {
    headers: { "content-type": "application/xml" },
  });
