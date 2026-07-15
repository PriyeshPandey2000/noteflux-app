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
- [x] Add allow-jit entitlement (com.apple.security.cs.allow-jit) — was a hypothesis, turned out not the root cause but harmless/correct to have
- [x] Bump version to 0.0.23
- [x] Patch mlx-generated Metal kernel sources in build.sh for Toolchain 32023 (actual root cause fix)
- [x] Bump version to 0.0.24

## Review

v0.0.21: Updated Package.resolved with mlx-swift 0.31.6 and speech-swift at main HEAD. mlx-swift 0.31.4 had hardcoded GPU detection; 0.31.6 delegates to MLX C++ core which properly recognizes M4 on Tahoe.

v0.0.22: Fixed silent crash reporting. Previously `realStdoutFd` was declared inside `do{}`, making it inaccessible in `catch{}`. Swift errors went to inherited stderr (invisible under qwen3-asr-cli in Console.app) and Rust saw only a pipe disconnect, reporting the generic "sidecar crashed" message. Fix: move `realStdoutFd` and `writeLine()` outside `do{}`, write `LOAD_ERROR:<msg>` to stdout in `catch{}`. Rust now shows the actual Swift error message in the toast.

v0.0.23: Added `com.apple.security.cs.allow-jit` entitlement. Was a hypothesis (MLX Metal JIT needs mmap PROT_WRITE|PROT_EXEC under hardened runtime). Turned out NOT the root cause — behavior was identical. Entitlement is harmless and correct to have regardless.

v0.0.24: Fixed actual root cause. MLX embeds Metal kernel source as C++ raw strings in `mlx-generated/*.cpp`. At runtime, MLX JIT-compiles these into GPU kernels. Metal Toolchain 32023 (shipped with Xcode 26 / macOS 26 Tahoe) moved bare SIMD types (`uint2`, `float2`, `half2`, etc.) to require `using namespace metal;` qualification. 29 of 47 mlx-generated files were missing this declaration, causing JIT compilation to fail with a Swift `fatalError` → `_exit(-1)` = exit 255 (no crash report generated).

Fix: `build.sh` now runs `swift package resolve` first (to fetch sources), then patches all affected `.cpp` files by inserting `using namespace metal;` right after each `R"preamble(` opening. Idempotent: skips files that already have the declaration. Compatible with all Apple Silicon (M1/M2/M3/M4) — the namespace declaration is valid on all Metal toolchain versions.

## ACTUAL ROOT CAUSE (v0.0.26) — everything above v0.0.26 was chasing the wrong error

The crash was reproduced locally on the user's M4/Tahoe machine (the same environment as the failure) instead of shipping blind to CI. The daemon redirects `stdout` to `/dev/null` before loading the model (`main.swift`), which was swallowing MLX's real error. MLX prints its fatal error to `stdout`, not `stderr`, so with the redirect it exited 255 silently. Temporarily disabling the redirect and rebuilding surfaced the truth:

```
MLX error: Failed to load the default metallib. library not found ... at .../mlx-c/mlx/c/memory.cpp:24
```

It was never a Metal Toolchain / JIT / `using namespace metal;` problem — the bundled metallib is precompiled AIR and MLX never JIT-compiles those preamble strings when it can load the metallib. The `vec<>`/namespace theory, the `allow-jit` entitlement, and the `mlx-generated` source patch were all red herrings.

The real bug: MLX searches for `default.metallib` in a fixed set of locations (`device.cpp` `load_default_library`): colocated with the running binary, in a SwiftPM `mlx-swift_Cmlx.bundle`, or as a relative `default.metallib` resolved against the process working directory. The metallib is bundled by Tauri into `Contents/Resources/`, but the sidecar binary runs from `Contents/MacOS/` — none of MLX's colocated searches look in `Contents/Resources/`, so it fell through every path and threw "library not found".

The dev's `MLX_METAL_PATH` env var (passed from Rust) was dead code — MLX reads no such variable.

Fix: spawn the sidecar with its working directory set to the metallib's folder (`cmd.current_dir(dir)` in `qwen_ensure_daemon`), so MLX's relative-path fallback resolves `default.metallib` against `Contents/Resources/` where the file already lives. Verified locally: daemon reaches `READY` and loads weights. Also reverted the useless `build.sh` source patch and corrected the wrong "JIT-compile from scratch / metallib only covers the build machine's GPU generation" comment in `lib.rs` — an AIR metallib is GPU-family-agnostic and works on M1–M4.

Also `main.swift:148` note for the future: the `freopen("/dev/null", ...)` redirect hides MLX load errors. If a load failure ever needs debugging again, redirect stdout to stderr instead of `/dev/null` so MLX's error is visible while keeping the protocol channel (the saved fd) clean.
