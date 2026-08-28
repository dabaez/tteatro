#!/usr/bin/env bash
#
# deploy.sh — build the site on the server and publish it to $WWW_DIR.
#
#   ./scripts/deploy.sh          # full deploy: git pull + clean install + tickets + build
#   ./scripts/deploy.sh tickets  # cron mode: refresh tickets.json + rebuild only
#
# Both modes take an exclusive lock, so a cron run and a push-triggered deploy
# can never interleave.
#
# The droplet is small, so every run starts from a clean tree and cleans up
# after itself: a full deploy throws away node_modules and reinstalls from the
# lockfile (no stale/half-updated dependencies), and both modes drop the build
# output and prune the pnpm store once the site is published.
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

# Runs on success or failure: never leave build artifacts behind on the droplet.
cleanup() {
  local status=$?
  echo "--- cleanup"
  rm -rf "$REPO_DIR/dist" "$REPO_DIR/.astro" "$REPO_DIR/node_modules/.vite"
  # drop packages in the global store that nothing references any more
  pnpm store prune >/dev/null 2>&1 || true
  df -h "$REPO_DIR" | tail -n 1
  echo "=== $(date -Is) exit $status ==="
}
trap cleanup EXIT

if [ "$MODE" = "full" ]; then
  git pull
  # start from scratch so an updated lockfile can't leave stale packages around
  rm -rf node_modules dist .astro
  pnpm install --frozen-lockfile
fi

# tickets.json is untracked and server-owned; regenerate it before every build.
node scripts/update-tickets.js

pnpm build

mkdir -p "$WWW_DIR"
rm -rf "${WWW_DIR:?}"/*
cp -r dist/. "$WWW_DIR"/
