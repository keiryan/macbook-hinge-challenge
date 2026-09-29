#!/bin/bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hinge_port=8768
browser_only=0

usage() {
  printf '%s\n' 'Usage: ./scripts/run.sh [--browser-only] [--port PORT]' \
    'Builds the optional native reader and serves the demo on 127.0.0.1.' \
    '--browser-only skips the Swift build and disables the native bridge.'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --browser-only) browser_only=1; shift ;;
    --port)
      if [ "$#" -lt 2 ]; then usage >&2; exit 2; fi
      hinge_port="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
case "$hinge_port" in ''|*[!0-9]*) printf '%s\n' 'Port must be an integer from 1 to 65535.' >&2; exit 2 ;; esac
if [ "${#hinge_port}" -gt 5 ] || [ "$hinge_port" -lt 1 ] || [ "$hinge_port" -gt 65535 ]; then
  printf '%s\n' 'Port must be an integer from 1 to 65535.' >&2; exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' 'Python 3 is required. Install it separately, then run this script again.' >&2; exit 1
fi

if [ "$browser_only" -eq 1 ]; then
  exec python3 "$project_dir/scripts/serve.py" --port "$hinge_port"
fi
if [ "$(uname -s)" != Darwin ] || ! command -v xcrun >/dev/null 2>&1 || ! xcrun --find swiftc >/dev/null 2>&1; then
  printf '%s\n' 'Native mode requires macOS and the Swift compiler from Xcode or its Command Line Tools.' \
    'Install those separately, or use --browser-only for direct WebHID.' >&2; exit 1
fi
mkdir -p "$project_dir/.build/module-cache"
printf '%s\n' 'Building the local, read-only sensor helper…'
xcrun swiftc -O -module-cache-path "$project_dir/.build/module-cache" \
  "$project_dir/native/lid-reader.swift" -o "$project_dir/.build/lid-reader"
exec python3 "$project_dir/scripts/serve.py" --reader "$project_dir/.build/lid-reader" --port "$hinge_port"
