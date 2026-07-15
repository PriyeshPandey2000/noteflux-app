# Qwen3-ASR Tahoe Crash Fix (v0.0.21)

## Problem

Users on macOS 26 Tahoe get "Qwen3-ASR sidecar crashed during model load" immediately after model download completes. Console.app shows "No persisted cache on this platform." before the crash.

## Root Cause

mlx-swift 0.31.4 hardcoded GPU detection logic that did not properly recognize the M4 GPU family on macOS 26 Tahoe. This caused MLX to report "No persisted cache on this platform" (meaning: bundled metallib doesn't match this GPU), falling back to JIT Metal shader compilation. JIT compilation then crashes due to Metal Toolchain 32023's `vec` namespace change (moved to `metal::` namespace), causing a SIGABRT before the process even outputs anything useful.

The mlx-swift 0.31.5 release (June 30, 2026) fixes this with: `fix(Device): resolve initial default from MLX core, not hard-coded GPU`. By delegating device resolution to the MLX C++ core (which properly enumerates Apple GPU families), M4 is recognized and the pre-compiled metallib is loaded directly — no JIT needed.

## Fix

- Update `mlx-swift`: 0.31.4 → 0.31.6 (includes 0.31.5 device fix + 0.31.6 process guard fix)
- Update `speech-swift`: old `0d09a2ed` → latest main `335a68c0` (July 14, 2026)

Done via `swift package update` in `apps/whispering/src-tauri/qwen3-asr-cli/`.

## Tasks

- [x] Run `swift package update` to update Package.resolved
- [x] Verify mlx-swift bumped to 0.31.6 and speech-swift to latest main
- [x] Bump version to 0.0.21 in tauri.conf.json
- [x] Commit and create PR
- [ ] Tag v0.0.21 and push after PR is merged

## Review

Updated Package.resolved with mlx-swift 0.31.6 (latest, July 2, 2026) and speech-swift at main HEAD (July 14, 2026). Version bumped to 0.0.21. No code changes — purely a dependency update. The CI (macos-26 runner) will build fresh with the updated xcframeworks that correctly handle M4 GPU on Tahoe.
