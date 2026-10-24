#!/bin/bash
# Install the built packages on a clean Ubuntu and check what a new user goes through: first the core alone,
# then the Calendar add-on up to the Google sign-in (which needs a person and a browser).
# Run as root inside a container: packaging/test-install.sh dist/tiny-harness_<v>_<arch>.deb dist/tiny-harness-calendar_<v>_all.deb
set -euxo pipefail

# `! cmd` would not stop the script under set -e, so expected failures go through this.
fails() { if "$@"; then echo "expected this to fail: $*" >&2; return 1; fi; }

CORE=$PWD/$1
ADDON=$PWD/$2
apt-get update -qq

# The core alone: no Python comes with it, and it starts from any folder.
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$CORE"
fails dpkg -s python3 >/dev/null 2>&1
help=$(tiny-harness --help)
grep -q calendar-setup <<<"$help"
cd /tmp
out=$(echo exit | tiny-harness)
grep -q '^session: ' <<<"$out"
fails tiny-harness calendar-setup 2>err.txt
grep -q 'Calendar add-on is not installed' err.txt
out=$(printf '/install-gcal\n' | tiny-harness)
grep -q 'No add-on provides /install-gcal' <<<"$out"

# The add-on: before setup the calendar points the user to calendar-setup.
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$ADDON"
fails tiny-harness gcal list a b 2>err.txt
grep -q 'calendar-setup' err.txt

# /install-gcal installs the libraries, then stops at the question for the Google client file (no input here).
printf '/install-gcal\n' | tiny-harness 2>err.txt
grep -q 'No file given' err.txt
"$HOME/.local/share/tiny-harness/calendar/venv/bin/python3" -c 'import googleapiclient, google_auth_oauthlib'

# With the libraries but no sign-in, the calendar script says how to sign in instead of opening a browser.
fails tiny-harness gcal list 2026-01-01T00:00:00Z 2026-01-02T00:00:00Z 2>err.txt
grep -q 'Not signed in' err.txt

# The harness still starts with the add-on loaded.
out=$(echo exit | tiny-harness)
grep -q '^session: ' <<<"$out"

echo "install test passed"
