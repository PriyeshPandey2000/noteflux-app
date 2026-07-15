#!/bin/bash
# Build qwen3-asr-cli and place binary for Tauri sidecar bundling.
# Requires: macOS 15+, Xcode 16+, Apple Silicon
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARIES_DIR="$SCRIPT_DIR/../binaries"

echo "Building qwen3-asr-cli (release)..."
cd "$SCRIPT_DIR"

# Resolve packages first so we can patch sources before compilation.
swift package resolve

# Metal Toolchain 32023 (macOS 26 Tahoe) requires bare SIMD types like uint2/float2
# to be qualified with 'using namespace metal;'. mlx-swift embeds Metal kernel source
# as C++ raw strings; ~29 of those files are missing this declaration and will fail
# JIT compilation on Tahoe. Patch them here, idempotently.
MLX_GENERATED="$SCRIPT_DIR/.build/checkouts/mlx-swift/Source/Cmlx/mlx-generated"
if [ -d "$MLX_GENERATED" ]; then
    echo "Patching MLX Metal kernels for Toolchain 32023 compatibility..."
    for f in "$MLX_GENERATED"/*.cpp; do
        if grep -q 'R"preamble(' "$f" && ! grep -q 'using namespace metal;' "$f"; then
            perl -i -0pe 's/R"preamble\(\n/R"preamble(\nusing namespace metal;\n/g' "$f"
            echo "  Patched: $(basename "$f")"
        fi
    done
fi

swift build -c release

BUILT_BINARY=".build/release/QwenASRCLI"
TARGET_BINARY="$BINARIES_DIR/qwen3-asr-cli-aarch64-apple-darwin"

mkdir -p "$BINARIES_DIR"
cp "$BUILT_BINARY" "$TARGET_BINARY"

echo "Binary placed at: $TARGET_BINARY"
echo "Done."
