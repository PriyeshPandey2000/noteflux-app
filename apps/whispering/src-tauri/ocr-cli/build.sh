#!/bin/bash
# Build ocr-cli and place binary for Tauri sidecar bundling.
# Requires: macOS, Xcode command line tools
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARIES_DIR="$SCRIPT_DIR/../binaries"

echo "Building ocr-cli (release)..."
cd "$SCRIPT_DIR"
swift build -c release

BUILT_BINARY=".build/release/OCRCLI"
TARGET_BINARY="$BINARIES_DIR/ocr-cli-aarch64-apple-darwin"

mkdir -p "$BINARIES_DIR"
cp "$BUILT_BINARY" "$TARGET_BINARY"

echo "Binary placed at: $TARGET_BINARY"
echo "Done."
