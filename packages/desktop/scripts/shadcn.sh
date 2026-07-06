#!/bin/sh
# Wrapper for the shadcn CLI. The CLI detects the framework by looking for a
# vite.config.* file, but this package uses electron-vite (electron.vite.config.ts),
# so we drop a stub Vite config for the duration of the command.
#
# Usage (from packages/desktop): ./scripts/shadcn.sh add <component>
set -eu
cd "$(dirname "$0")/.."

if [ -e vite.config.ts ]; then
  echo "vite.config.ts already exists; refusing to overwrite it." >&2
  exit 1
fi

cat > vite.config.ts <<'EOF'
// Temporary stub written by scripts/shadcn.sh so the shadcn CLI detects Vite.
// The real config is electron.vite.config.ts. Safe to delete if left behind.
import { defineConfig } from "vite";
export default defineConfig({});
EOF
trap 'rm -f vite.config.ts' EXIT

npx shadcn@latest "$@"
