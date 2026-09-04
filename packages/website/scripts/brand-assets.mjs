// One-off generator for the site's brand images from the desktop app icon:
// favicon, Apple touch icon, and the Open Graph card. Outputs are committed;
// rerun with `npm run brand-assets -w @accountant24/website` after an icon change.
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const icon = new URL("../../desktop/build/icon.png", import.meta.url).pathname;
const out = new URL("../public/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

// The macOS icon has transparent padding around the rounded tile; crop to the tile.
const tile = () => sharp(icon).extract({ left: 100, top: 100, width: 824, height: 824 });

await tile().resize(64, 64).png().toFile(`${out}favicon.png`);
await tile().resize(180, 180).flatten({ background: "#ffffff" }).png().toFile(`${out}apple-touch-icon.png`);

// Open Graph card: 1200x630, icon tile on the left, name and headline on the right.
const width = 1200;
const height = 630;
const text = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .name { font: 700 64px "Inter Variable", Inter, "Helvetica Neue", Helvetica, Arial, sans-serif; fill: #0e1a1c; letter-spacing: -2px; }
    .line { font: 500 40px "Inter Variable", Inter, "Helvetica Neue", Helvetica, Arial, sans-serif; fill: #0e1a1c; }
    .accent { fill: #0f766e; font-size: 34px; }
    .url { font: 500 28px "IBM Plex Mono", Menlo, monospace; fill: #5b7176; }
  </style>
  <text x="440" y="196" class="name">Accountant24</text>
  <text x="440" y="290" class="line">Open source AI agent</text>
  <text x="440" y="342" class="line">for personal finance</text>
  <text x="440" y="410" class="line accent">Runs on your machine, you own the data</text>
  <text x="440" y="496" class="url">accountant24.ai</text>
</svg>`;
const tileBuffer = await tile().resize(300, 300).png().toBuffer();
await sharp({ create: { width, height, channels: 4, background: "#f4f8f8" } })
  .composite([
    { input: tileBuffer, left: 90, top: 165 },
    { input: Buffer.from(text), left: 0, top: 0 },
  ])
  .png()
  .toFile(`${out}og.png`);
// The hero/closing wallpaper: AVIF is what browsers actually load (the WebP
// beside it is the fallback for those without AVIF, and is the source here).
const wallpaper = `${out}hero-forest-dither`;
await sharp(`${wallpaper}.webp`).avif({ quality: 50 }).toFile(`${wallpaper}.avif`);

console.log("brand assets written to", out);
