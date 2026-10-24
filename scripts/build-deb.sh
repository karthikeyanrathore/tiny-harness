#!/bin/bash
# Build the Ubuntu packages (22.04 and later) into dist/:
#   tiny-harness_<version>_<arch>.deb         the coding agent with its own Node; no Python
#   tiny-harness-calendar_<version>_all.deb   the optional Google Calendar add-on (Python, Google libraries)
# Usage: scripts/build-deb.sh [amd64|arm64]   (default: amd64). Needs curl, tar and dpkg-deb.
set -euo pipefail

ARCH=${1:-amd64}
NODE_VERSION=v24.22.0
case "$ARCH" in
  amd64) NODE_ARCH=x64 ;;
  arm64) NODE_ARCH=arm64 ;;
  *) echo "unknown architecture: $ARCH (use amd64 or arm64)" >&2; exit 1 ;;
esac

cd "$(dirname "$0")/.."
VERSION=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json)
[ -n "$VERSION" ] || { echo "no version in package.json" >&2; exit 1; }
MAINTAINER="karthikeyan_01 <karthikerathore@gmail.com>"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Node: the official build, checked against nodejs.org's published SHA-256 sums.
NODE_TAR="node-$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
curl -fsSL -o "$WORK/$NODE_TAR" "https://nodejs.org/dist/$NODE_VERSION/$NODE_TAR"
curl -fsSL -o "$WORK/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
expected=$(awk -v f="$NODE_TAR" '$2 == f { print $1 }' "$WORK/SHASUMS256.txt")
actual=$(shasum -a 256 "$WORK/$NODE_TAR" | awk '{ print $1 }')
[ -n "$expected" ] && [ "$expected" = "$actual" ] || { echo "checksum mismatch for $NODE_TAR" >&2; exit 1; }
tar -xJf "$WORK/$NODE_TAR" -C "$WORK"

# The core package: the harness and Node, nothing from addons/.
CORE="$WORK/core"
LIB="$CORE/usr/lib/tiny-harness"
mkdir -p "$CORE/DEBIAN" "$CORE/usr/bin" "$LIB/node/bin" "$LIB/src" "$CORE/usr/share/doc/tiny-harness"
install -m 755 "$WORK/node-$NODE_VERSION-linux-$NODE_ARCH/bin/node" "$LIB/node/bin/node"
install -m 644 "$WORK/node-$NODE_VERSION-linux-$NODE_ARCH/LICENSE" "$LIB/node/LICENSE"
install -m 644 package.json "$LIB/package.json"
install -m 644 src/*.ts "$LIB/src/"
install -m 755 packaging/tiny-harness "$CORE/usr/bin/tiny-harness"
install -m 644 README.md "$CORE/usr/share/doc/tiny-harness/README.md"
cat > "$CORE/DEBIAN/control" <<CONTROL
Package: tiny-harness
Version: $VERSION
Architecture: $ARCH
Maintainer: $MAINTAINER
Installed-Size: $(du -sk "$CORE/usr" | awk '{ print $1 }')
Depends: libc6 (>= 2.28), libstdc++6
Recommends: git
Suggests: tiny-harness-calendar
Section: devel
Priority: optional
Homepage: https://github.com/karthikeyanrathore/tiny-harness
Description: minimal coding-agent harness
 A model chooses tools, the harness runs them, and every step is recorded in
 an append-only session log. Bundles its own Node.js $NODE_VERSION.
CONTROL

# The Calendar add-on: only text files, so one package for every CPU.
ADDON="$WORK/calendar"
ADDON_LIB="$ADDON/usr/lib/tiny-harness/addons/calendar"
mkdir -p "$ADDON/DEBIAN" "$ADDON_LIB"
install -m 644 addons/calendar/index.ts addons/calendar/gcal_tool.py addons/calendar/requirements.txt "$ADDON_LIB/"
install -m 755 addons/calendar/gcal addons/calendar/calendar-setup "$ADDON_LIB/"
cat > "$ADDON/DEBIAN/control" <<CONTROL
Package: tiny-harness-calendar
Version: $VERSION
Architecture: all
Maintainer: $MAINTAINER
Installed-Size: $(du -sk "$ADDON/usr" | awk '{ print $1 }')
Depends: tiny-harness (= $VERSION), python3, python3-venv
Recommends: xdg-utils
Section: devel
Priority: optional
Homepage: https://github.com/karthikeyanrathore/tiny-harness
Description: Google Calendar add-on for tiny-harness
 Lets the tiny-harness model add, list and delete Google Calendar events.
 Run 'tiny-harness calendar-setup' once: it installs the Google libraries for
 your user, helps you create a Google OAuth client, and signs you in.
CONTROL

mkdir -p dist
dpkg-deb --root-owner-group -Zxz --build "$CORE" "dist/tiny-harness_${VERSION}_${ARCH}.deb"
dpkg-deb --root-owner-group -Zxz --build "$ADDON" "dist/tiny-harness-calendar_${VERSION}_all.deb"
