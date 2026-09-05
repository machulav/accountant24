// Generator for the site's derived brand images: the Open Graph card and the
// hero wallpaper's AVIF. Outputs are committed; rerun with
// `npm run brand-assets -w @accountant24/website` after a copy or wallpaper change.
import { fileURLToPath } from "node:url";
import { dev } from "astro";
import { chromium } from "playwright";
import sharp from "sharp";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}public/`;

// Open Graph card: og-card.astro rendered by the site's own dev server (the
// real fonts, palette, copy and field), screenshotted at 1200x630. The route
// exists only in this server; the built site never ships it.
const width = 1200;
const height = 630;
const server = await dev({
  root,
  logLevel: "error",
  devToolbar: { enabled: false },
  server: { port: 4399, open: false },
  integrations: [
    {
      name: "og-card",
      hooks: {
        "astro:config:setup": ({ injectRoute }) =>
          injectRoute({ pattern: "/og-card", entrypoint: "./scripts/og-card.astro" }),
      },
    },
  ],
});
try {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: "light" });
    await page.goto(`http://localhost:${server.address.port}/og-card`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${out}og.png` });
  } finally {
    await browser.close();
  }
} finally {
  await server.stop();
}

// The hero/closing wallpaper: AVIF is what browsers actually load (the WebP
// beside it is the fallback for those without AVIF, and is the source here).
// The `-sm` pair is the phone cut: a phone shows the wallpaper at most 40rem
// wide, where 1032px is plenty at 2x and half the bytes, and there the
// picture is the largest thing in the first screen, so its bytes set the LCP.
const wallpaper = `${out}hero-forest-dither`;
await sharp(`${wallpaper}.webp`).avif({ quality: 50 }).toFile(`${wallpaper}.avif`);
await sharp(`${wallpaper}.webp`).resize(1032).avif({ quality: 50 }).toFile(`${wallpaper}-sm.avif`);
await sharp(`${wallpaper}.webp`).resize(1032).webp({ quality: 82 }).toFile(`${wallpaper}-sm.webp`);

console.log("brand assets written to", out);
