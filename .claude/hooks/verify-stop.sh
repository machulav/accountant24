#!/bin/bash

INPUT=$(cat)
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active')

# Prevent infinite loops — if we already blocked once, let Claude stop
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  exit 0
fi

# Fingerprint = HEAD commit + status + tracked diffs + untracked file contents
tree_hash() {
  {
    git rev-parse HEAD
    git status --porcelain
    git diff HEAD
    git ls-files --others --exclude-standard -z | xargs -0 cat 2>/dev/null
  } | shasum -a 256 | cut -d' ' -f1
}

# Skip verify when the tree matches the last state that passed verification.
# State lives in the OS temp dir keyed by project path, so each worktree gets
# its own cache and nothing is written into the repo.
STATE_FILE="${TMPDIR:-/tmp}/claude-verify-$(echo "${CLAUDE_PROJECT_DIR:-$PWD}" | shasum | cut -d' ' -f1)"

if [ -f "$STATE_FILE" ] && [ "$(cat "$STATE_FILE")" = "$(tree_hash)" ]; then
  exit 0
fi

# Run verification; exit 2 blocks the stop and feeds stderr back to Claude
OUTPUT=$(npm run verify 2>&1)
STATUS=$?

if [ $STATUS -ne 0 ]; then
  echo "$OUTPUT" >&2
  exit 2
fi

# Hash after verify ran — biome check --write may have auto-fixed files
tree_hash > "$STATE_FILE"
exit 0
