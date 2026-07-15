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
- [x] Tag v0.0.21 and push after PR is merged
- [x] Fix realStdoutFd scoping bug in main.swift (catch{} can now write LOAD_ERROR to stdout)
- [x] Handle LOAD_ERROR: protocol in lib.rs to surface real Swift error to user
- [x] Bump version to 0.0.22

## Review

v0.0.21: Updated Package.resolved with mlx-swift 0.31.6 and speech-swift at main HEAD. mlx-swift 0.31.4 had hardcoded GPU detection; 0.31.6 delegates to MLX C++ core which properly recognizes M4 on Tahoe.

v0.0.22 (in-progress): Fixed silent crash reporting. Previously `realStdoutFd` was declared inside `do{}`, making it inaccessible in `catch{}`. Swift errors went to inherited stderr (invisible under qwen3-asr-cli in Console.app) and Rust saw only a pipe disconnect, reporting the generic "sidecar crashed" message. Fix: move `realStdoutFd` and `writeLine()` outside `do{}`, write `LOAD_ERROR:<msg>` to stdout in `catch{}`. Rust now shows the actual Swift error message. This will reveal whether the crash is a Metal JIT issue, missing metallib, or something else entirely.
