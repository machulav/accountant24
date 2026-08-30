#!/bin/sh
# Local preview of the whole site with hot reload: the landing page (Astro dev
# server) at http://127.0.0.1:4321 with /docs proxied to a local Mintlify dev
# server (mint on :3000), so both reload on edit behind one URL.
# Stopping this script (Ctrl-C, kill) stops both servers.
set -e
cd "$(dirname "$0")/.."

sh scripts/docs.sh &
docs_pid=$!
cleanup() {
  kill "$docs_pid" 2>/dev/null || true
  (cd packages/website && npx astro dev stop >/dev/null 2>&1) || true
}
trap cleanup EXIT INT TERM

DOCS_PROXY_TARGET=http://localhost:3000 npm run dev -w @accountant24/website -- --host 127.0.0.1 --port 4321

# Without a TTY the Astro dev server detaches and the line above returns at
# once; keep this process (and mint) alive until it is stopped.
wait "$docs_pid"
