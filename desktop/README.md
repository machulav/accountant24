# Accountant24 — Desktop app

A native macOS app (Tauri v2 + React) that drives the Accountant24 agent. The
agent itself is the existing `accountant24` binary, bundled as an **RPC sidecar**;
the Rust shell is thin glue and all UI is React. The same RPC boundary is what a
future networked iOS client would talk to.

```
React UI (webview)  ──invoke──▶  Rust shell  ──spawn──▶  accountant24 --mode rpc   (the agent)
       ▲                            │         ──spawn──▶  accountant24 auth <cmd>   (credentials)
       └────── Tauri events ────────┘
```

One binary, multiple modes (see `../src/index.ts`):
- default → TUI (`InteractiveMode`) — still shipped via Homebrew formula for CLI users
- `--mode rpc` → headless JSONL agent over stdio (what this app spawns)
- `auth <subcommand>` → credential helper (`../src/cli/auth.ts`)

## Develop

```bash
# 1. Build + stage the sidecar from current source
#    (writes desktop/src-tauri/binaries/accountant24-<triple>)
cd ..            # repo root
bun run build

# 2. Run the app
cd desktop
bun install
bun run tauri dev
```

`bun run build` (root) compiles the binary and copies it under the Rust
target-triple name Tauri expects. Re-run it whenever you change agent/auth code.

In `tauri dev` the bundled native tools (below) are NOT staged, so the agent
falls back to the tools on your `PATH` (Homebrew). That's intentional for dev.

## Native dependencies (bundled for release)

The agent shells out to `hledger`, `pdftotext` (poppler), and `tesseract`
(`-l eng`). For a zero-setup `.dmg`, these are bundled into the app:

```
src-tauri/bin/        hledger, pdftotext, tesseract     (vendor macOS arm64 + x64 builds)
src-tauri/tessdata/   eng.traineddata                   (copied from repo root)
```

They are resolved at runtime by `src-tauri/src/env.rs`, which prepends
`<Resources>/bin` to `PATH` and sets `TESSDATA_PREFIX=<Resources>/tessdata` when
spawning the sidecar — **no agent source changes needed**.

These binaries are git-ignored (large, platform-specific). Populate `bin/`
before a release build, e.g. a `vendor-deps` step that pulls static/self-contained
builds. Verify each has no Homebrew-pathed dylibs: `otool -L src-tauri/bin/*`.

## Build a distributable

```bash
cd ..; bun run build:all            # builds + stages sidecars for all targets
cd desktop; bun run tauri build     # produces .app + .dmg under src-tauri/target/release/bundle/
```

### Code signing & notarization (required for non-technical users)

Without this, Gatekeeper blocks the app. Needs an Apple **Developer ID
Application** certificate ($99/yr Apple Developer account).

- `entitlements.plist` is already wired in `tauri.conf.json`
  (`bundle.macOS.entitlements`). It enables JIT + unsigned executable memory (the
  bun/JavaScriptCore sidecar) and disables library validation (so bundled tool
  dylibs load).
- Sign **inside-out**: the sidecar and `bin/*` executables must be signed before
  the outer `.app`. Tauri signs nested binaries when a signing identity is set.
- Provide signing/notarization via env vars to `tauri build`:

  ```bash
  export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
  export APPLE_ID="you@example.com"
  export APPLE_PASSWORD="app-specific-password"   # or APPLE_API_KEY / APPLE_API_ISSUER
  export APPLE_TEAM_ID="TEAMID"
  bun run tauri build
  ```

- Verify on a clean Mac: download the `.dmg`, open — no Gatekeeper warning.

### Auto-update (Phase 5 — not yet wired)

Add `tauri-plugin-updater` (Rust + JS), generate a Tauri updater keypair
(`tauri signer generate`), set `plugins.updater.pubkey` + `endpoints` in
`tauri.conf.json`, and publish the signed manifest + artifacts to GitHub Releases.
Kept out for now so the build needs no keypair.

## Distribution channels

- **Desktop app:** the notarized `.dmg` on GitHub Releases (drag to Applications).
  Not published to Homebrew — direct download only.
- The existing **formula** (CLI/TUI) stays as-is in the tap; the desktop app does
  not touch it.
