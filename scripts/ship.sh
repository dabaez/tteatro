#!/usr/bin/env bash
#
# ship.sh — publish tteatro to the droplet.
#
# deploy.yml runs this, and so can you from your own machine, so a GitHub
# outage never blocks a deploy:
#
#   DEPLOY_TARGET=tteatro-deploy scripts/ship.sh              # upload the committed source
#   DEPLOY_TARGET=tteatro-deploy scripts/ship.sh rebuild      # refresh ticket links now
#   DEPLOY_TARGET=tteatro-deploy scripts/ship.sh rollback     # previous release goes live
#   DEPLOY_TARGET=tteatro-deploy scripts/ship.sh activate <release-id>
#   DEPLOY_TARGET=tteatro-deploy scripts/ship.sh releases     # list releases, * is live
#
# DEPLOY_TARGET is anything ssh accepts: tteatro@<droplet>, or a Host alias
# from ~/.ssh/config that sets the user and the deploy key. On the droplet the
# key can only run receive-site (dabaez/droplet-infra), which unpacks the
# upload, builds it with deploy/build (fresh ticket links need the droplet),
# switches the site to it and installs deploy/systemd/.
#
set -euo pipefail

TARGET="${DEPLOY_TARGET:?set DEPLOY_TARGET, e.g. tteatro@<droplet> or an ssh config alias}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

remote() {
  ssh -o BatchMode=yes "$TARGET" "$@"
}

case "${1:-}" in
"") ;;
rebuild | rollback | releases)
  remote "$1"
  exit
  ;;
activate)
  remote activate "${2:?usage: ship.sh activate <release-id>}"
  exit
  ;;
*)
  echo "usage: ship.sh [rebuild | rollback | releases | activate <release-id>]" >&2
  exit 1
  ;;
esac

# Only committed files are uploaded; refuse rather than silently leave
# uncommitted changes out.
if [ -n "$(git status --porcelain)" ]; then
  echo "uncommitted changes; commit or stash them before shipping:" >&2
  git status --short >&2
  exit 1
fi

id="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short=12 HEAD)"
echo "--- shipping $id to $TARGET (the droplet builds it)"
# receive-site builds source shipped under app/.
git archive --format=tar.gz --prefix=app/ HEAD | remote deploy "$id"
