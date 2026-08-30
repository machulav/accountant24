// Copies the demo videos from docs/videos into public/videos before dev/build,
// so the 10+ MB files live in git once (the docs site already ships them).
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const source = new URL("../../../docs/videos/", import.meta.url).pathname;
const target = new URL("../public/videos/", import.meta.url).pathname;

mkdirSync(target, { recursive: true });
for (const name of readdirSync(source)) {
  if (!name.endsWith(".mp4")) continue;
  const from = join(source, name);
  const to = join(target, name);
  let upToDate = false;
  try {
    upToDate = statSync(to).size === statSync(from).size;
  } catch {}
  if (!upToDate) copyFileSync(from, to);
}
