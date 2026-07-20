#!/bin/sh
# Run the Mintlify CLI for the docs site: `npm run docs` starts the local
# preview, `npm run docs -- broken-links` runs any other mint command.
# mint refuses non-LTS Node (25+), so when the default node is too new, a
# Homebrew LTS node is put first in PATH and used to run the CLI.
set -e
cd "$(dirname "$0")/../docs"

[ $# -eq 0 ] && set -- dev

major="$(node -v | sed 's/^v//' | cut -d. -f1)"
if [ "$major" -ge 25 ]; then
  for dir in /opt/homebrew/opt/node@24/bin /usr/local/opt/node@24/bin /opt/homebrew/opt/node@22/bin; do
    if [ -x "$dir/node" ]; then
      PATH="$dir:$PATH"
      export PATH
      exec "$dir/node" "$(command -v mint)" "$@"
    fi
  done
fi

exec mint "$@"
