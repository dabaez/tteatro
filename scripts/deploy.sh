#!/usr/bin/env bash
#
# deploy.sh — build the site on the server and publish it to $WWW_DIR.
#
#   ./scripts/deploy.sh          # full deploy: git pull + install + tickets + build
#   ./scripts/deploy.sh tickets  # cron mode: refresh tickets.json + rebuild only
#
# Both modes take an exclusive lock, so a cron run and a push-triggered deploy
# can never interleave.
#
set -euo pipefail

# cron runs with a minimal PATH — make sure node/pnpm are reachable.
export PATH="$PATH:/usr/local/bin:/usr/bin:$HOME/.local/share/pnpm:$HOME/.nvm/versions/node/current/bin"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WWW_DIR="${WWW_DIR:-/var/www/tteatro}"
MODE="${1:-full}"

cd "$REPO_DIR"

exec 9>"$REPO_DIR/.deploy.lock"
flock 9

echo "=== $(date -Is) deploy.sh ($MODE) ==="

if [ "$MODE" = "full" ]; then
  git pull
  rm -rf dist node_modules/.vite .astro
  pnpm install --frozen-lockfile
fi

# tickets.json is untracked and server-owned; regenerate it before every build.
node scripts/update-tickets.js

pnpm build

mkdir -p "$WWW_DIR"
rm -rf "${WWW_DIR:?}"/*
cp -r dist/. "$WWW_DIR"/

echo "=== $(date -Is) done ==="
