#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_PUBLIC_SSH_KEY_B64:?Missing public snapshot deploy key}"
: "${GITHUB_PUBLIC_KNOWN_HOSTS:?Missing verified GitHub host keys file}"
: "${GITHUB_PUBLIC_ROOT:?Missing verified public root commit}"
: "${CI_DEFAULT_BRANCH:?Missing default branch}"
: "${CI_COMMIT_SHA:?Missing verified pipeline commit}"

# Publish only the commit verified by this default-branch pipeline. A queued old
# pipeline must never publish a newer, unverified tree or roll back public files.
git fetch --quiet --no-tags origin "refs/heads/$CI_DEFAULT_BRANCH"
if [[ "$(git rev-parse FETCH_HEAD)" != "$CI_COMMIT_SHA" ]]; then
  echo 'Skipping superseded public snapshot.'
  exit 0
fi

umask 077
public_sync_dir=$(mktemp -d)
trap 'rm -rf "$public_sync_dir"' EXIT
printf '%s' "$GITHUB_PUBLIC_SSH_KEY_B64" | base64 --decode > "$public_sync_dir/id_ed25519"
cp "$GITHUB_PUBLIC_KNOWN_HOSTS" "$public_sync_dir/known_hosts"
export GIT_SSH_COMMAND="ssh -i \"$public_sync_dir/id_ed25519\" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=\"$public_sync_dir/known_hosts\""

# Pin both scanner version and archive checksum. No scanner failure may publish.
curl --fail --silent --show-error --location \
  'https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz' \
  --output "$public_sync_dir/gitleaks.tar.gz"
printf '%s  %s\n' '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb' "$public_sync_dir/gitleaks.tar.gz" | sha256sum --check --status
tar -xzf "$public_sync_dir/gitleaks.tar.gz" -C "$public_sync_dir" gitleaks
export GITLEAKS_BIN="$public_sync_dir/gitleaks"

node scripts/public-sync.mjs "$CI_PROJECT_DIR" "$CI_COMMIT_SHA" \
  'ssh://git@ssh.github.com:443/ldy5413/meeting-recorder.git' \
  "$GITHUB_PUBLIC_ROOT"
