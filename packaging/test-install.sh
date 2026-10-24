#!/bin/bash
# Install a built .deb on a clean Ubuntu and check what a new user goes through, up to the Google sign-in
# (which needs a person and a browser). Run as root inside a container: packaging/test-install.sh dist/<file>.deb
set -euxo pipefail

# `! cmd` would not stop the script under set -e, so expected failures go through this.
fails() { if "$@"; then echo "expected this to fail: $*" >&2; return 1; fi; }

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "./$1"

help=$(tiny-harness --help)
grep -q calendar-setup <<<"$help"
# The harness starts, and from a folder that is not the project.
cd /tmp
out=$(echo exit | tiny-harness)
grep -q '^session: ' <<<"$out"

# Before setup, the calendar points the user to calendar-setup.
fails tiny-harness gcal list a b 2>err.txt
grep -q 'calendar-setup' err.txt

# Setup installs the libraries, then stops at the question for the Google client file (no input here).
fails tiny-harness calendar-setup </dev/null 2>err.txt
grep -q 'No file given' err.txt
"$HOME/.local/share/tiny-harness/venv/bin/python3" -c 'import googleapiclient, google_auth_oauthlib'

# With the libraries but no sign-in, the calendar script says how to sign in instead of opening a browser.
fails tiny-harness gcal list 2026-01-01T00:00:00Z 2026-01-02T00:00:00Z 2>err.txt
grep -q 'Not signed in' err.txt

echo "install test passed"
