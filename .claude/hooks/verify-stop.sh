#!/bin/bash

INPUT=$(cat)
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active')

# Prevent infinite loops — if we already blocked once, let Claude stop
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  exit 0
fi

# Run verification; exit 2 blocks the stop and feeds stderr back to Claude
OUTPUT=$(bun verify 2>&1)
STATUS=$?

if [ $STATUS -ne 0 ]; then
  echo "$OUTPUT" >&2
  exit 2
fi

exit 0
