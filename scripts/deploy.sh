#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/deploy.sh <ssh-target> [remote-directory]

Build the repository, synchronize the working tree to an SSH host, and run
`npm install` remotely. The remote directory defaults to ~/homelib.

Files absent locally are deleted remotely after a successful transfer. The
remote .git and node_modules directories are preserved.

Environment:
  DEPLOY_SSH  SSH executable to use (default: ssh)

Requires Bash, rsync, and npm on the remote host.

Examples:
  npm run deploy -- pi@meian-hub
  npm run deploy -- home-server /srv/homelib
EOF
}

if [[ ${1:-} == '--help' || ${1:-} == '-h' ]]; then
  usage
  exit 0
fi

if (($# < 1 || $# > 2)); then
  usage >&2
  exit 2
fi

ssh_target=$1
remote_directory=${2:-'~/homelib'}
ssh_executable=${DEPLOY_SSH:-ssh}
ssh_options=(
  -o ConnectTimeout=15
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=4
)

if [[ -z $ssh_target || $ssh_target == -* ]]; then
  echo 'Invalid SSH target.' >&2
  exit 2
fi

case $remote_directory in
  '' | / | . | ./ | '~' | '~/')
    echo "Unsafe remote directory: $remote_directory" >&2
    exit 2
    ;;
esac

if [[ $remote_directory == *$'\n'* || $remote_directory == *$'\r'* ]]; then
  echo 'The remote directory must not contain a newline.' >&2
  exit 2
fi

for command in npm rsync "$ssh_executable"; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command not found: $command" >&2
    exit 127
  fi
done

repository_directory=$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
  pwd -P
)

printf 'Building %s...\n' "$repository_directory"
(
  cd -- "$repository_directory"
  npm run build
)

printf -v remote_directory_argument '%q' "$remote_directory"
printf 'Preparing %s:%s...\n' "$ssh_target" "$remote_directory"
remote_output=$(
  "$ssh_executable" "${ssh_options[@]}" "$ssh_target" \
    "bash -s -- $remote_directory_argument" <<'REMOTE_SCRIPT'
set -euo pipefail

input=$1

case $input in
  '~/'*) directory="$HOME/${input:2}" ;;
  /*) directory=$input ;;
  *) directory="$HOME/$input" ;;
esac

mkdir -p -- "$directory"
directory=$(cd -P -- "$directory" && pwd -P)
home_directory=$(cd -P -- "$HOME" && pwd -P)

if [[ $directory == / || $directory == "$home_directory" ]]; then
  echo "Unsafe resolved remote directory: $directory" >&2
  exit 2
fi

printf 'HOMELIB_DEPLOY_PATH=%s\n' "$directory"
REMOTE_SCRIPT
)
remote_directory=$(
  sed -n 's/^HOMELIB_DEPLOY_PATH=//p' <<<"$remote_output" | tail -n 1
)

if [[ -z $remote_directory || $remote_directory != /* ]]; then
  echo 'Failed to resolve the remote directory.' >&2
  exit 1
fi

printf -v rsync_ssh_command '%q ' "$ssh_executable" "${ssh_options[@]}"
rsync_ssh_command=${rsync_ssh_command% }

printf 'Synchronizing to %s:%s...\n' "$ssh_target" "$remote_directory"
rsync \
  --archive \
  --compress \
  --delete-delay \
  --human-readable \
  --itemize-changes \
  --protect-args \
  --rsh="$rsync_ssh_command" \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='.cache/' \
  --exclude='*.tsbuildinfo' \
  --exclude='*.tgz' \
  --exclude='.DS_Store' \
  --exclude='npm-debug.log' \
  "$repository_directory/" \
  "$ssh_target:$remote_directory/"

printf -v install_command 'cd -- %q && npm install' "$remote_directory"
printf -v install_command_argument '%q' "$install_command"
printf 'Installing dependencies on %s...\n' "$ssh_target"
"$ssh_executable" "${ssh_options[@]}" "$ssh_target" \
  "bash -lc $install_command_argument"

printf 'Deployed to %s:%s\n' "$ssh_target" "$remote_directory"
