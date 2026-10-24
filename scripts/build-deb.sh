#!/bin/bash
# Build dist/tiny-harness_<version>_<arch>.deb with its own Node, for Ubuntu 22.04 and later.
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

ROOT="$WORK/root"
LIB="$ROOT/usr/lib/tiny-harness"
mkdir -p "$ROOT/DEBIAN" "$ROOT/usr/bin" "$LIB/node/bin" "$LIB/src" "$LIB/scripts" "$ROOT/usr/share/doc/tiny-harness"
install -m 755 "$WORK/node-$NODE_VERSION-linux-$NODE_ARCH/bin/node" "$LIB/node/bin/node"
install -m 644 "$WORK/node-$NODE_VERSION-linux-$NODE_ARCH/LICENSE" "$LIB/node/LICENSE"
install -m 644 package.json "$LIB/package.json"
install -m 644 src/*.ts "$LIB/src/"
install -m 644 scripts/gcal_tool.py scripts/requirements.txt "$LIB/scripts/"
install -m 755 packaging/calendar-setup "$LIB/calendar-setup"
install -m 755 packaging/tiny-harness "$ROOT/usr/bin/tiny-harness"
install -m 644 README.md "$ROOT/usr/share/doc/tiny-harness/README.md"

cat > "$ROOT/DEBIAN/control" <<EOF
Package: tiny-harness
Version: $VERSION
Architecture: $ARCH
Maintainer: karthikeyan_01 <karthikerathore@gmail.com>
Installed-Size: $(du -sk "$ROOT/usr" | awk '{ print $1 }')
Depends: libc6 (>= 2.28), libstdc++6, python3, python3-venv
Recommends: git, xdg-utils
Section: devel
Priority: optional
Homepage: https://github.com/karthikeyanrathore/tiny-harness
Description: minimal coding-agent harness with Google Calendar tools
 A model chooses tools, the harness runs them, and every step is recorded in
 an append-only session log. Bundles its own Node.js $NODE_VERSION.
 Run 'tiny-harness calendar-setup' once to use the Google Calendar tools.
EOF

mkdir -p dist
dpkg-deb --root-owner-group -Zxz --build "$ROOT" "dist/tiny-harness_${VERSION}_${ARCH}.deb"
