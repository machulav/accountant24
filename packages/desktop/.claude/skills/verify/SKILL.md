---
name: verify
description: Verify desktop-app UI changes by launching the Electron dev app and driving it over CDP (screenshots, clicks, JS eval). Use when a change to packages/desktop needs runtime/visual verification.
---

# Verify packages/desktop changes in the running app

## Launch

Never run against the real workspace (`~/.accountant24`): always create a fresh
test workspace and launch on it. From `packages/desktop`, in the background:

```sh
npm run dev -- -- --workspace "$(mktemp -d /tmp/a24-verify-XXXX)" --remote-debugging-port=9224
```

The main process logs `[workspace] using <dir> (flag|env|default)` at startup;
`(default)` means the instance is on the user's real data: stop it and relaunch.
A fresh workspace boots to the onboarding screen (no providers), where Cmd+,
does nothing: open Settings by clicking "Use an API key", or seed the folder
first (e.g. an `auth.json`) to boot into the chat layout.

Gotchas:

- **Check for leftovers first**: `lsof -nP -iTCP:9223 -iTCP:9224 -iTCP:5173 -sTCP:LISTEN`.
  The user's own dev instance usually holds CDP 9223 and vite 5173, which is why
  you launch on 9224 (vite auto-increments to 5174). A second launch on an
  occupied CDP port fails to bind with `bind() failed: Address already in use`
  but still opens a window you can't drive. A leftover with an **empty**
  `/json/list` is a windowless instance (macOS keeps the app alive after the
  window closes).
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

## Clean up

Kill only your own instance: the Electron PID listening on your CDP port
(`lsof -nP -iTCP:9224 -sTCP:LISTEN -t`), its `electron-vite` parent, and the
`npm run dev` grandparent. Never `pkill -f electron` or
`pkill -f electron-vite`: those also match the user's running instance and other
worktrees. Then delete the test workspace folder.
