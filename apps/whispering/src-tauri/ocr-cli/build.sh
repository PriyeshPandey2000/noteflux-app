#!/bin/bash
# Build ocr-cli and place binary for Tauri sidecar bundling.
# Requires: macOS, Xcode command line tools
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARIES_DIR="$SCRIPT_DIR/../binaries"

echo "Building ocr-cli (release)..."
cd "$SCRIPT_DIR"

mkdir -p "$BINARIES_DIR"
for ARCH in arm64 x86_64; do
	swift build -c release --arch "$ARCH"
	TRIPLE=$([ "$ARCH" = arm64 ] && echo aarch64-apple-darwin || echo x86_64-apple-darwin)
	TARGET_BINARY="$BINARIES_DIR/ocr-cli-$TRIPLE"
	cp ".build/$ARCH-apple-macosx/release/OCRCLI" "$TARGET_BINARY"
	echo "Binary placed at: $TARGET_BINARY"
done

echo "Done."
