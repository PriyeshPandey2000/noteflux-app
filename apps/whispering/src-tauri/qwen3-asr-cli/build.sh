#!/bin/bash
# Build qwen3-asr-cli and place binary for Tauri sidecar bundling.
# Requires: macOS 15+, Xcode 16+, Apple Silicon
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARIES_DIR="$SCRIPT_DIR/../binaries"

echo "Building qwen3-asr-cli (release)..."
cd "$SCRIPT_DIR"
swift build -c release

BUILT_BINARY=".build/release/QwenASRCLI"
TARGET_BINARY="$BINARIES_DIR/qwen3-asr-cli-aarch64-apple-darwin"

mkdir -p "$BINARIES_DIR"
cp "$BUILT_BINARY" "$TARGET_BINARY"

echo "Binary placed at: $TARGET_BINARY"
echo "Done."
