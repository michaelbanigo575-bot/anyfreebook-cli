#!/usr/bin/env bash
#
# Publish anyfreebook-cli: GitHub repo, then npm.
#
#   ./publish.sh
#
# Requires:
#   - `gh` logged in with permission to create repositories
#     (fine-grained PAT: "Administration" -> "Write"; or a classic PAT with `repo`)
#   - `npm` logged in for the publish step (`npm login`)
#   - a clean working tree
#
# The npm publish is optional and runs last. Pass --no-npm to stop after GitHub.

set -euo pipefail

cd "$(dirname "$0")"

REPO_SLUG="michaelbanigo575-bot/anyfreebook-cli"
PKG="anyfreebook-cli"
SKIP_NPM=0
[ "${1:-}" = "--no-npm" ] && SKIP_NPM=1

echo "==> Checking the working tree"
if [ -n "$(git status --porcelain)" ]; then
  echo "    Uncommitted changes. Commit them first." >&2
  git status --short
  exit 1
fi

echo "==> Running the test suite"
npm test

echo "==> Creating the GitHub repository (public)"
if gh repo view "$REPO_SLUG" >/dev/null 2>&1; then
  echo "    Already exists — skipping creation."
else
  gh repo create "$REPO_SLUG" \
    --public \
    --description "Search 7 open-access book sources and download only what is verifiably public domain. CLI + Python SDK for the ANYFREEBOOK API." \
    --source . \
    --remote origin \
    --push
fi

echo "==> Making sure the remote is set and pushing"
if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "https://github.com/$REPO_SLUG.git"
fi
git push -u origin main

echo "==> Repository: https://github.com/$REPO_SLUG"

if [ "$SKIP_NPM" = "1" ]; then
  echo "==> Skipping npm publish (--no-npm)."
  exit 0
fi

echo "==> Publishing to npm"
npm publish --access public

cat <<'EOF'

Done.

  GitHub : https://github.com/michaelbanigo575-bot/anyfreebook-cli
  npm    : npm install -g anyfreebook-cli

Remember to bump the version in package.json before every publish.
EOF
