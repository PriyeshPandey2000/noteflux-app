# macOS Accessibility/Microphone Permission Resets After Every App Update

**Created:** 2026-09-11
**Status:** Analysis only — not implemented
**Complexity:** High (core-feature-touching if the full fix is built)
**Estimated Impact:** Every app update currently re-triggers full onboarding for
returning users, because the OS silently drops Accessibility/Mic trust on
update — even through the correct in-app "Restart Now" updater flow.

## Problem Statement

### Symptom
Every time the desktop app updates — even through the correct in-app "Restart
Now" flow (`check()` → `downloadAndInstall()` → `relaunch()`) — Accessibility
and/or Microphone permission checks come back `false` on the next launch,
which reopens the full onboarding flow. Users who completed onboarding long
ago get thrown back into it after every single release.

### What was verified, and what wasn't the cause
- **Not storage/flag corruption.** `settings.value['app.onboardingCompleted']`
  persists correctly forever in localStorage, no version key, nothing clears
  it.
- **Not unsigned/inconsistent CI builds.** Confirmed via `gh secret list` +
  actual CI run logs: all 6 Apple signing secrets are configured, unrotated
  since 2025-11-02, and the latest macOS build (`v0.0.26`) shows
  `Notarizing Finished with status Accepted`. Signing identity is stable and
  correct.
- **Not a code bug in the permission-check helpers.** Read `accessibility.rs`
  and `microphone.rs` directly — both are clean, direct, synchronous native
  API calls (`AXIsProcessTrustedWithOptions`,
  `AVCaptureDevice.authorizationStatusForMediaType`), no caching layer, no
  obvious race in the Rust layer itself.
- **Not the "manual reinstall" failure mode** documented in Tauri's own
  issue tracker
  ([tauri-apps/tauri#10567](https://github.com/tauri-apps/tauri/issues/10567)) —
  that thread's reporter said the in-app updater path is fine and only
  manual GitHub-Releases redownload breaks it. Confirmed happening even via
  "Restart Now," ruling this out.

### Actual root cause
A real, independently-documented, **unresolved macOS platform bug**, not
specific to this codebase:
- Apple's own developer forums
  ([thread 99868](https://developer.apple.com/forums/thread/99868), open
  since 2020, no Apple response): multiple developers report the identical
  pattern — `AXIsProcessTrustedWithOptions` reads `true` right after
  granting, then `false` right after the process restarts, with the app
  silently dropped from the Accessibility list.
- Confirmed on real, unrelated, popular shipped apps via Apple Community
  support threads: **Karabiner-Elements, BetterSnapTool, Typinator, Magnet,
  Shottr** all have users reporting the same "permissions reset, have to
  re-grant" complaint. Apple support's own answer to one of these:
  *"might be due to the API being used by these applications, may be
  resolved in future updates"* — i.e., a known, unfixed platform issue.
- Mechanism (best current understanding, not 100% Apple-confirmed): TCC's
  internal grant state doesn't always finish "settling" before a fast
  process restart re-queries it, and/or TCC's Accessibility entries can bind
  to file path/inode state that a replaced binary doesn't cleanly match,
  even under consistent code-signing identity.

### Severity / why this matters more than it might look
This isn't cosmetic. `keyboard/macos.rs` runs a system-wide `CGEventTap` —
that IS the "hold Fn to dictate" feature, the core of the product. If
Accessibility trust is what's flaky, the app's primary feature silently
breaks on every update until the user notices and re-grants, and in the
meantime they're shoved through a full onboarding replay that doesn't even
explain why.

### Why the cheap fixes only mask this
Two mitigations were previously proposed (retry-with-delay before trusting a
`false` reading; decoupling "needs re-grant" from "show full onboarding").
Both reduce user pain but don't address why the OS is dropping the grant in
the first place — they make the symptom less annoying, not less frequent.

## Proposed Solution: separate, rarely-touched Accessibility helper process

### Core idea
TCC's Accessibility grant is tied to a specific process's code-signing
identity. If the specific compiled binary that calls the Accessibility APIs
is **never rebuilt or resigned** across app releases, there's nothing for
TCC to get confused about on update — the trusted binary literally doesn't
change, release over release. The main app UI can update every single
release without ever touching the binary that holds the grant.

This is the same pattern Karabiner-Elements and Bartender use: a separate
helper/daemon holds the OS-level trust; the frequently-updated main app is
just a UI shell that talks to it.

### What moves out of the main app
From `keyboard/macos.rs`: the entire `CGEventTap` global-hotkey listener
(`start_event_tap`, `handle_event_tap`, `handle_flags_changed`,
`handle_key_down` — the actual "Fn held down" detection).
From `accessibility.rs`: `is_macos_accessibility_enabled`,
`get_selection_with_context` (focused-text-selection reads).
Microphone check (`microphone.rs`) is arguably lower-risk/lower-value to
move — mic permission isn't reported as flaky in the same way in any of the
research, so could stay in the main process; worth confirming before
deciding to move it too.

### Why this repo already has the mechanical pattern for this
`lib.rs` already runs a persistent, long-lived sidecar process for a
completely different reason — the "Qwen3-ASR sidecar daemon" (comment:
*"model loads once, stays alive"*). It's a separately compiled binary
(`qwen3-asr-cli`), declared in `tauri.conf.json`'s `bundle.externalBin`,
resolved via `qwen_daemon_paths()`, spawned with `std::process::Command`,
kept alive for the app's session, communicated with over stdin/stdout. A new
`accessibility-helper` binary would follow this exact same mechanism —
spawn, keep-alive, stream events over stdout — just holding a different kind
of long-lived process instead of an ASR model.

### Proposed components

**1. New helper binary** (own small Rust crate, e.g. `accessibility-helper/`)
- Owns the `CGEventTap` loop and the AX read calls.
- On each detected hotkey event, writes a line of structured output (e.g.
  newline-delimited JSON: `{"event":"fn_down"}` / `{"event":"fn_up"}`) to
  stdout.
- Exposes its own accessibility-check as a simple stdin command/response, or
  just checks and reports status proactively on a short interval.

**2. Main app changes**
- ~~Spawn the helper on app launch (same lifecycle pattern as the existing
  ASR daemon — no need for it to survive independent of the main app via a
  macOS Login Item / `SMAppService`).~~ **Superseded — see "Correction after
  competitive research" below.** A plain spawned child process is not
  strong enough; the real-world proven pattern needs full Login Item
  registration.
- Read its stdout stream continuously in a background task; forward parsed
  events into whatever currently consumes `handle_flags_changed`/
  `handle_key_down`'s output.
- `is_macos_accessibility_enabled` Tauri command becomes a thin proxy that
  asks the helper instead of calling the AX API directly in-process.
- Supervise: restart the helper if it crashes/exits unexpectedly; surface a
  clear error state if it can't be spawned at all (missing binary, corrupted
  install) rather than silently failing.

**3. Build/CI change — the part that actually delivers the stability benefit**
- The helper must be built and signed **once**, then the identical compiled
  artifact reused across every future release — not rebuilt from source on
  every CI run the way `qwen3-asr-cli` currently is in
  `publish-tauri-releases.yml`. Rebuilding-and-resigning it every release
  would reintroduce the exact same "identity might not be perfectly stable
  across separate signing operations" exposure this whole approach is meant
  to avoid.
- Concretely: build + sign the helper once, store that exact signed artifact
  somewhere durable (a pinned GitHub release asset, or checked into a
  private artifact store), and have every future release's CI step *copy*
  that file into the bundle instead of recompiling it. Only rebuild+resign
  it as a deliberate, rare, manual action if the helper's own logic needs to
  change.

### Failure modes to design for
- Helper binary missing or fails to spawn on first run → app should degrade
  to a clear "hotkey unavailable, contact support" state, not a silent
  broken feature.
- IPC stream breaks mid-recording → needs a heartbeat/reconnect strategy,
  since this is now a live dependency for the app's core feature working at
  all.
- The helper's own *first-ever* grant (when a user installs the app for the
  very first time) still goes through the same flaky OS mechanism once —
  this doesn't eliminate the underlying macOS bug, it just stops *repeated*
  exposure to it release-over-release.

### What this does NOT fix
- Doesn't fix the underlying macOS bug — nobody can, it's an unresolved
  Apple platform issue.
- Doesn't eliminate risk from the "stale TCC path/inode" theory if that's
  actually the real mechanism rather than pure identity — reduces exposure,
  isn't a provable guarantee. (See reviewer critique below — this concern
  turned out to be the load-bearing one.)
- Adds real ongoing ops overhead: a second signed artifact to manage, a
  manual "when do we deliberately update the helper" process, and a new IPC
  surface that's now load-bearing for the core feature.

### Honest cost/benefit vs. the cheap fixes
The retry-with-delay + decouple-from-onboarding mitigations are low-risk,
low-effort, and improve the experience *every time this still happens*. This
helper-process rewrite is a bigger, riskier change to the app's most central
runtime path, and its benefit is probabilistic (less exposure to a flaky OS
behavior), not a guaranteed fix. Worth doing only if the cheap fixes don't
reduce complaints enough in practice.

## Reviewer Critique (external review, verbatim)

> This analysis is highly accurate, and your proposed architecture is the
> industry-standard workaround for this exact macOS bug, with one critical
> flaw in the deployment mechanism that will cause your solution to fail if
> not adjusted.
>
> **The macOS TCC Bug**
> Your diagnosis of the Transparency, Consent, and Control (TCC) system is
> spot on. TCC is notoriously brittle when it comes to Accessibility
> (`CGEventTap`) grants across app updates. Even with a perfectly stable code
> signing identity (Designated Requirement), the process of replacing an
> `.app` bundle during an update frequently corrupts or drops the TCC
> database entry.
>
> **The Deployment Flaw (The Inode Problem)**
> Your plan to build and sign the helper binary once and reuse it across CI
> runs is smart, but **bundling it inside the main app will not fix the
> issue**.
>
> When Tauri (or Sparkle) updates an app, it deletes the old `.app` bundle
> and moves the new one into place. Even if the helper binary is
> byte-for-byte identical, its file path and inode will change because the
> parent folder was replaced. TCC often binds to the inode and absolute
> path. If the helper lives in `/Applications/YourApp.app/Contents/Helpers/`,
> the update will destroy the inode, TCC will treat it as a new file, and
> the permission will drop again.
>
> To actually bypass the bug, the helper must be installed *outside* the
> main app bundle. Tools like Karabiner and Bartender copy their persistent
> helpers to `~/Library/Application Support/YourApp/` or
> `/Library/PrivilegedHelperTools/`. The main app only updates the helper in
> that external directory if the version explicitly requires it.
>
> **IPC and Architecture**
> Using standard stdin/stdout for IPC via a Tauri sidecar is perfectly fine
> for this. `CGEventTap` is fast, and streaming newline-delimited JSON over
> stdout will easily handle typing speeds without noticeable latency,
> provided you buffer efficiently and avoid blocking the main event loop in
> the Rust helper.
>
> **Strategic Priority**
> Your cost/benefit conclusion is the most pragmatic part of the document.
> Moving a core feature to an external, IPC-dependent daemon introduces
> significant operational complexity, potential zombie processes, and
> complex recovery states. Implementing the "cheap fixes" (retry logic with
> a short delay before trusting a `false` reading, and decoupling the grant
> failure from the full onboarding UI) is the correct first step. You should
> only build this sidecar architecture if telemetry shows the cheap
> mitigations are failing to shield the user from the friction.

## Updated conclusion after critique

The critique's correction is real and changes the design: the helper cannot
live inside `Contents/Helpers/` or anywhere under the `.app` bundle that
Tauri's updater replaces wholesale — it must be **installed once to a
location outside the bundle** (e.g.
`~/Library/Application Support/NoteFlux/accessibility-helper`), with the
main app copying/updating it there only on a deliberate version bump of the
helper itself, never as a side effect of a normal app update. The
`externalBin`/`qwen3-asr-cli`-style sidecar pattern is still the right model
for *how the main app spawns and talks to it* — the fix is *where the binary
physically lives on disk*, not the IPC mechanism.

Sequencing agreed: ship the cheap mitigations first (retry-with-delay,
decouple re-grant prompt from full onboarding). Only build this sidecar
architecture if that's insufficient in practice.

## Second Reviewer Critique — new edge cases if this is ever built (verbatim)

> Migrating to a separate helper process prevents Accessibility permissions
> from dropping across updates, but it replaces one OS bug with a few
> runtime edge cases you need to engineer around.
>
> **New Edge Cases & Mitigation Strategies**
>
> | Risk Area | What Can Go Wrong | How to Prevent It |
> | --- | --- | --- |
> | **On-Disk Path & Inode Changes** | If the helper binary lives inside `/Applications/YourApp.app/Contents/MacOS/`, replacing the main `.app` bundle during an in-app update still changes the helper's file inode/path, which can still cause TCC to revoke access. | Extract or place the signed helper binary once at `~/Library/Application Support/YourApp/` so its absolute file path stays untouched across updates. |
> | **Process Crash & Orphan States** | If the helper crashes, global hotkeys (`CGEventTap`) silently stop working; if the main app crashes, the helper process remains running as a zombie. | Add process supervision in the main app to auto-restart the sidecar if the stdout pipe closes, and add a parent-PID ping in the helper to terminate itself if orphaned. |
> | **IPC Overhead & Event Lag** | Streaming low-level key events over `stdout` introduces IPC serialization latency compared to running in-process. | Keep event payloads minimal (e.g., standard newline-delimited flags like `{"e":"fn_down"}`), use unbuffered line writing in Rust, and parse asynchronously. |
> | **First-Run Permission UX** | When requesting Accessibility access for the first time, macOS System Settings displays the helper executable's name instead of your main application name. | Set clean binary metadata (`CFBundleName`) or name the binary explicitly (e.g., `YourApp Helper`) so users recognize it in System Settings. |
>
> **User Experience Changes**
>
> * **First Launch:** Users must still grant Accessibility permission once
>   during their initial setup.
> * **In-App Updates:** Future releases update the main UI shell without
>   triggering permission prompts or re-launching onboarding.
> * **Hotkey Responsiveness:** Key hold/release detection (`Fn` dictation)
>   functions identically to the in-process implementation once the stdout
>   stream is active.

This confirms the "On-Disk Path & Inode" fix from the first critique
(external-to-bundle install location) and adds four more concrete engineering
concerns (crash/orphan supervision, IPC lag, first-run helper naming in
System Settings) that would need to be designed for before this is
production-ready. Reinforces the existing sequencing decision: this is real,
non-trivial scope for a probabilistic mitigation of an OS bug, not a
same-week fix. Ship the cheap mitigations first.

Note: the helper does **not** need to be written in Swift or any language
other than Rust — the underlying bug is about binary identity/on-disk
location, not implementation language. A small new Rust crate alongside the
existing `src-tauri` code is sufficient; this is not a rewrite of anything
already built.

## Competitive research: is this actually solved by other famous apps?

Checked whether well-known apps that rely on Accessibility APIs have
actually solved this, rather than assuming an industry-standard fix exists.

**Answer: no, not universally.** Two well-known, professionally maintained
apps confirmed to still have this exact bug, unresolved:
- **Rectangle** — quote from research: *"Nearly every time Rectangle quits
  working after a macOS update, the culprit is identical — the Accessibility
  permission got reset or invalidated... the toggle still reads as switched
  on in System Settings while the permission underneath has gone stale."*
  Only fix: manually remove + re-add in System Settings.
- **BetterTouchTool** — multiple open, unresolved threads on their own
  community forum with the identical complaint, including after full
  restarts.

**One app confirmed to have actually engineered around it: Karabiner-Elements.**
Ground truth from their official docs/DEVELOPMENT.md, not a blog guess:
Accessibility trust is held by a component called **`Karabiner-Core-Service`**,
which is registered as a proper **launchd user agent via `SMAppService`**,
approved once under System Settings → General → Login Items & Extensions.
Once approved as a Login Item, it's managed by the OS itself — persistent,
independent of whether the main GUI app is even running — and the main
Karabiner-Elements app updates freely without ever touching this agent's
binary or its Login Item registration.

### Correction after competitive research
The original proposal above said the helper "doesn't need to survive
independent of the main app via a macOS Login Item / `SMAppService`, since
the hotkey listener only needs to be alive while the app itself is running."
Karabiner's real, working, shipped precedent contradicts this — the thing
that actually stays stable across updates in the wild is a **properly
`SMAppService`-registered Login Item agent**, not a plain child process
spawned and killed by the main app. If this is ever built, it should follow
Karabiner's actual pattern:
- Helper installed once, outside the `.app` bundle (per the inode/path
  correction already captured above).
- Registered as a real macOS Login Item via `SMAppService`, requiring a
  one-time separate user approval (System Settings → General → Login Items
  & Extensions) in addition to the Accessibility grant itself.
- Runs independent of the main app's lifecycle, managed by launchd.

This is more work than the original "just a spawned child process" version
— it adds Login Item registration, a second user-facing approval step, and
its own persistent lifecycle to manage. Given Rectangle and BetterTouchTool
still have this bug despite being mature, well-resourced apps, there is no
shortcut that avoids this level of isolation if a real fix (rather than a
mitigation) is the goal.

**Conclusion holds, more strongly now:** this is real, substantial scope for
a mitigation of an OS bug that even major competing apps haven't reliably
solved. Ship the cheap fixes (retry-with-delay, decouple from onboarding)
first. Only pursue the full Karabiner-style Login Item agent architecture if
that proves insufficient in practice.

## Status
Not implemented. Analysis and design only, captured here for future
reference.
