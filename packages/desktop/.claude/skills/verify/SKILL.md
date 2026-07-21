---
name: verify
description: Verify desktop-app UI changes by launching the Electron dev app and driving it over CDP (screenshots, clicks, JS eval). Use when a change to packages/desktop needs runtime/visual verification.
---

# Verify packages/desktop changes in the running app

## Launch

From `packages/desktop`, run `npm run dev` in the background. The main process
(`src/main/index.ts`) auto-enables CDP on **port 9223** in dev — no extra
flags needed.

Gotchas:

- **Check for leftovers first**: `lsof -nP -iTCP:9223 -iTCP:5173 -sTCP:LISTEN`.
  A previous dev instance (possibly the user's) may hold 9223; a second launch
  then fails to bind CDP with `bind() failed: Address already in use` but still
  opens a window you can't drive. A leftover with an **empty** `/json/list` is
  a windowless instance (macOS keeps the app alive after the window closes).
- Port 9222 is usually the user's Chrome — don't use it.
- Wait for a `"type": "page"` target to appear before driving (~10s).
- Don't `echo ===` in zsh compound commands — zsh treats `=word` as path
  expansion and kills the rest of the command.

## Drive

Node ≥22 has a global WebSocket client, so a dependency-free CDP driver works.
A ready-made one may exist from a past session; otherwise recreate `cdp.mjs`
with commands: `targets`, `eval <js>` (Runtime.evaluate with awaitPromise),
`shot <file.png>` (Page.captureScreenshot), `clicktext <button text>`, and
`tap <x> <y>` (Input.dispatchMouseEvent pressed+released).

- Open Settings: dispatch ONE synthetic Cmd+, keydown on `window`
  (`new KeyboardEvent("keydown", {key: ",", metaKey: true, bubbles: true})`).
  Dispatching on both window and document toggles it twice.
- Base UI Switch: synthetic `label.click()` does NOT toggle it (the htmlFor
  target is Base UI's hidden input). Use a trusted `tap` at the label's
  coordinates, or `switchEl.click()` on the `[role=switch]` element.
- Rows re-sort after toggles (enabled/available lists) — re-query coordinates
  before every tap; never tap the same coordinates twice.

## Restore state

Toggles persist to `~/Accountant24/app-settings.json` immediately. If probing
changed `enabledModels` / `analyticsEnabled`, restore the file afterwards
(all-models-enabled is stored as `enabledModels: []`). Kill your dev instance
when done: `pkill -f "accountant24/node_modules/electron"` and
`pkill -f "accountant24/node_modules/.bin/electron-vite"`.
