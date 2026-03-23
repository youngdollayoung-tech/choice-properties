#!/bin/bash
set -e

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: GITHUB_TOKEN secret is not set."
  exit 1
fi

git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/youngdollayoung-tech/choice-properties.git"
git push origin main
echo "Done — pushed to GitHub successfully."
