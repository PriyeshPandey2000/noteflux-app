# Parakeet ASR integration (supersedes the plan in `docs/issues/20260916T000000-parakeet-local-model.md`)

**Created:** 2026-09-28
**Branch:** `feature/parakeet-local-asr`
**Status:** plan approved in discussion 2026-09-28; implementation not started.

The original ticket (`docs/issues/20260916T000000-parakeet-local-model.md`, mirrored as
GitHub issue #41) is left untouched as the historical record of what was believed on
2026-09-16. This spec supersedes it. Corrections below are all verified against the
code and the vendored `speech-swift` checkout as of 2026-09-28; the ticket's own
instruction to re-grep before editing applies here too.

---

## 1. What changed since the ticket was written

### 1.1 The integration architecture in the ticket is not how this app works

The ticket's Phase 1 picks between two server processes on two ports, forking
`riedemannai/parakeet-mlx-server`, or finding a different OpenAI-compatible server. All
three options are moot: local ASR in this app is not an HTTP service.

It is a Swift sidecar speaking a line protocol over stdio:

- `apps/whispering/src-tauri/qwen3-asr-cli/Sources/QwenASRCLI/main.swift:141-202` —
  loads the model once, prints `READY`, then reads `"<audio_path>\t<language>"` lines
  from stdin and writes `OK:<transcript>` / `ERR:<msg>` to a duplicated stdout fd.
- `apps/whispering/src-tauri/src/lib.rs:821` (`qwen_daemon_paths`) and `:847`
  (`qwen_ensure_daemon`) — spawn and supervise it.
- `apps/whispering/src/lib/services/transcription/qwen3-asr.ts:224` — `invoke('transcribe_qwen3_asr')`.

There is no port, no HTTP client, and nothing to fork. What the ticket called "Phase 1,
low effort, ships fast" is what it called "Phase 2".

### 1.2 The model artifact in the ticket is the wrong one, by ~4x on size

The ticket targets `mlx-community/parakeet-tdt-0.6b-v2` / `-v3` MLX safetensors at
2.47GB / 2.51GB, unquantized, and spends its largest section ("Size, honestly")
admitting that this is worse than the Qwen models already shipping.

`speech-swift` — already a dependency of the sidecar — ships Parakeet TDT v3 as a
first-class module, `Sources/ParakeetASR/`, on **CoreML with an INT8 encoder**:
`aufklarer/Parakeet-TDT-v3-CoreML-INT8-30s`, **634MB** (`docs/benchmarks/asr-wer.md:70`).

That is smaller than the 680MB Qwen3-ASR 0.6B that is the app's current default
(`qwen3-asr.ts:24-29`), and it comes from the same maintainer (`aufklarer`).

This dissolves the ticket's central weakness. It also inverts its pitch: the ticket
argues the honest case for Parakeet is latency and *not* size. With the CoreML build
you get both.

### 1.3 The v2 + v3 picker cannot be executed

The ticket locks "offer both v2 and v3, not revisiting again". `speech-swift` has no
v2 support: grepping `Sources/` for `tdt-0.6b-v2` returns nothing. The v3 model covers
25 European languages including English, so v2's only advantage was a 6.05 vs 6.34 WER
gap on a different benchmark that is not worth a second 634MB download.

**One model. v3. No picker.**

### 1.4 The VAD mitigation is described as reuse; it is new work

The ticket is emphatic that this is reuse, not engineering: *"This repo already has that
exact gate — `onVADMisfire` in `vad-recorder.ts` … so wiring Parakeet through it is
reuse, not new engineering. It must not be bypassed."*

It is not a gate. `onVADMisfire` calls `invalidateVadState()` and nothing else:

- `apps/whispering/src/lib/services/vad-recorder.ts:97`
- `apps/whispering/src/lib/query/vad-recorder.ts:55`

No audio is filtered before it reaches a model. The only protection today is that Qwen
returns an empty string for silence, which `qwen3-asr.ts:235` turns into a "No speech
detected" error. Parakeet is a batch transducer with no speech detector and will invent
words on silence, so this needs a real mechanism. Budget it as new work.

Available lever: `ParakeetASRModel.lastConfidence` is a public property
(`Sources/ParakeetASR/ParakeetASR.swift:46`), documented as a 0-1 sigmoid-scaled mean of
token logits. An RMS/energy check on the blob is the cheaper alternative.

### 1.5 The motivation is stale

The ticket motivates itself with Qwen3-ASR having *"noticeably"* latency and having
*"reportedly hung the app multiple times in practice"*.

The hang root cause was found and fixed on **2026-07-15** in `826311fb`
(`fix(qwen3-asr): run sidecar from Resources so MLX finds default.metallib`), shipped in
**v0.0.26 on 2026-09-11** (`f064f235`). See the "ACTUAL ROOT CAUSE" section of
`docs/specs/20260715T120000-qwen-asr-tahoe-mlx-fix.md`. The ticket is dated
**2026-09-16**, five days after that release.

There are also no hang or crash reports in the tracker: the repo has nine issues total
across its life and the only ASR-related one is #41 itself.

The user has not reproduced a hang since v0.0.26 (confirmed 2026-09-28). So this is
**reframed as an efficiency option, not a crash fix**: lower peak RAM, GPU offload to
the Neural Engine, faster RTF. That is a weaker but still real case, and it means this
should be scoped and shipped as an enhancement rather than treated as urgent.

### 1.6 Smaller corrections

- The ticket says the prior research is in `git stash@{7}`. It is `git stash@{8}`
  ("On whisperkit: local model experiments (moonshine, parakeet)"), 892 lines across 7
  files. `stash@{7}` is `whisperkit-wip`. Indices shift when new stashes are added, so
  resolve it by SHA before creating any stash.
- CC-BY-4.0 requires attribution in the app's licenses screen. The ticket notes this;
  it stays a requirement.

---

## 2. Answering the two questions this was gated on

### Is it English-only or multilingual?

Multilingual: **25 European languages with automatic detection**, no per-request language
required (`docs/inference/parakeet-asr-inference.md:36`). The API accepts an optional
language override (`transcribeAudio(_:sampleRate:language:)`, `ParakeetASR.swift:93`).

Limits: **no CJK** (no Chinese, Japanese, or Korean), no Hindi, no Arabic
(`asr-wer.md:99`). On FLEURS, Qwen3-ASR 8-bit beats Parakeet on every language except
Spanish (`asr-wer.md:84-99`).

Since local models are **free on all tiers** (confirmed 2026-09-28), Parakeet stays free
and ungated. The consequence to accept explicitly: the free tier gains speed and lower
RAM, while non-European-language users get a capability downgrade they did not ask for.
The settings copy must say so.

### How is its performance?

From `docs/benchmarks/asr-wer.md:8-24`, M5 Pro, LibriSpeech test-clean, n=200,
`--isolated` per-engine peak RSS. **These are M5 numbers, not M4.** No benchmark was run
on the user's M4; benchmarking was deliberately skipped in favour of testing the
integrated build locally (decision 2026-09-28).

| Engine | Backend | WER% | RTF | Peak RSS | Size |
|---|---|---|---|---|---|
| Qwen3-ASR 1.7B 4bit (current option) | MLX GPU | 1.52 | 0.033 | 2706 MB | 1.5GB |
| Qwen3-ASR 0.6B 4bit (current default) | MLX GPU | 2.20 | 0.012 | 1022 MB | 680MB |
| **Parakeet TDT v3 INT8** | **CoreML ANE** | **2.37** | **0.009** | **897 MB** | **634MB** |

Read honestly: Parakeet is about 8% worse on English WER than the current default, ~1.4x
faster, and uses *less* peak RAM. It is nowhere near the 1.7B on accuracy, so it is a
third option on the size/speed/accuracy curve, not a replacement for either Qwen model.

The structural argument is the GPU offload, not the raw numbers: the encoder runs on the
Neural Engine (`parakeet-asr-inference.md:9`), so ASR stops competing with the GPU for
everything else the app does.

Cold start to plan for: 3.1s model load, plus 5-11s of one-time ANE graph compile on
first run, cached to disk by CoreML afterwards (`asr-wer.md:20`,
`parakeet-asr-inference.md:98`).

---

## 3. Architecture decision

**One sidecar binary hosting multiple engines behind a flag.** Not a second
`parakeet-asr-cli`.

The deciding evidence is how much a second binary costs:

- `apps/whispering/src-tauri/tauri.conf.json:17` — `externalBin` has one entry.
- `apps/whispering/src-tauri/capabilities/default.json:63` — the shell permission
  names `qwen3-asr-cli` specifically.
- `.github/workflows/publish-tauri-releases.yml:112,114` — CI stubs the x86_64 binary
  and runs `build.sh` in `qwen3-asr-cli/`.

A second binary touches all three plus the bundle. Adding an engine to the existing one
touches none of them.

On the resident-memory question, note the ticket-era framing was wrong: two binaries
cannot sit resident at 897MB + 1022MB, because `qwen_ensure_daemon` kills and respawns
the daemon when the model id changes (`lib.rs:855-862`). The real cost of a second binary
is serial thrash, not summed RAM.

So the actual choice is a RAM-versus-latency one, and the first cut takes the cheap side:

- **(a) one model resident at a time, reload on switch** — ~1GB peak, 2-3s reload per
  switch. This is the current behaviour, extended. Ship this.
- (b) both resident in one process — ~1.9GB peak, instant switch. Defer; revisit only
  if users actually toggle between engines often enough to notice.

**Naming:** do not rename anything in this pass. `qwen3-asr.ts`, `transcribe_qwen3_asr`,
the `qwen3_asr_*` commands and the `qwen3-asr-cli` binary all keep their names. Add
`engine` as a parameter. A rename would touch six Rust commands, six TS invoke sites,
`tauri.conf.json`, the capabilities file and CI, for no user-visible benefit, and it
makes the diff unreviewable. Revisit once a second engine is actually shipped.

---

## 4. Todos

### Preparation
- [ ] Extract `docs/local-transcription.md` from `stash@{8}` **by SHA**, before creating
      any new stash (a new stash renumbers it to `stash@{9}`). Leave the stash itself
      intact. The Python benchmark scripts and `test_moonshine.html` are reference only.
- [ ] Commit the unrelated `settings/+layout.svelte` alignment fix on `main` (currently
      carried onto this branch). It is a legitimate one-line fix and committing avoids
      the stash renumbering entirely.
- [ ] Comment on GitHub issue #41 pointing at this spec, and note that the crash
      justification no longer holds.

### Swift sidecar
- [ ] `qwen3-asr-cli/Package.swift` — add
      `.product(name: "ParakeetASR", package: "speech-swift")` beside the existing
      `Qwen3ASR` product.
- [ ] `main.swift` — add an `--engine` flag (`qwen3` default, `parakeet`), dispatch
      model load and transcribe on it. The load at `main.swift:166` is hardcoded to
      `Qwen3ASRModel.fromPretrained`.
- [ ] `main.swift` — per-engine `--status` / `--download` / `--delete`. Parakeet is not
      safetensors: it fetches directory globs `encoder.mlmodelc/**`,
      `decoder.mlmodelc/**`, `joint.mlmodelc/**`, `vocab.json`, `config.json`
      (`ParakeetASR.swift:340-350`). The current `modelIsDownloaded()` at
      `main.swift:17-25` checks `vocab.json` + `weightsExist` and will not work for
      `.mlmodelc` directories.
- [ ] Progress reporting: many small files behave differently from one blob for
      byte-based progress and resume. Verify the `PROGRESS:<0-100>` protocol still
      behaves.
- [ ] Pass `offlineMode: true` on the Parakeet load, matching `main.swift:166`. The app
      must start with no network; `ParakeetASR.swift:314` supports the same flag.
- [ ] Call `warmUp()` (`ParakeetASR.swift:76`) after load to trigger the ANE compile
      before signalling `READY`, so the first real transcription is not a 10s wait.
- [ ] `bash build.sh` locally and confirm the binary is produced.

### Rust
- [ ] `lib.rs` — thread `engine` through `qwen_ensure_daemon` (`:847`) and the six
      commands (`:451-456`). Keep all command names.
- [ ] `qwen_daemon_paths` (`:821`) — the `current_dir` trick that makes MLX find
      `default.metallib` (the v0.0.26 fix) is harmless for Parakeet, which is CoreML
      and needs no metallib. Leave it.

### Frontend
- [ ] `qwen3-asr.ts` — add the Parakeet entry to `QWEN3_ASR_MODELS` (`:22-37`) with
      `size: '634MB'` and a description that states the European-language scope.
- [ ] `outputLanguage` validation client-side, as the ticket specified: Parakeet takes
      25 European languages plus auto. Reject unsupported values before invoking, the
      way `qwen3-asr.ts:205-211` does for Qwen.
- [ ] Silence gate — new work. Use `lastConfidence` with a floor, or an RMS check on
      the blob, or both. Must not be bypassable.
- [ ] Settings UI: expose it, opt-in, not default. Copy must say faster and lighter but
      European languages only.
- [ ] `preload` / warming-up equivalent for the Parakeet path, mirroring
      `isQwen3WarmingUp` (`qwen3-asr.ts:16`) so the settings UI can show a warming
      state during the 3.1s + ANE compile.
- [ ] Licenses screen: NVIDIA / Parakeet TDT, CC-BY-4.0 attribution.

### Test and ship
- [ ] Test locally on the M4. Record WER impression, wall-clock latency after stop, and
      peak memory for Parakeet vs both Qwen models. This replaces the skipped
      LibriSpeech benchmark.
- [ ] Confirm the silence gate actually holds by recording deliberate silence.
- [ ] Ship opt-in. Existing `transcription_started` / `transcription_completed` events
      already carry `provider` (wired in `ccb4f728`), so no new analytics is needed.
      Watch the provider split in PostHog before ever defaulting anyone onto it.
- [ ] Add a review section to this file.

---

## 5. Explicitly out of scope

- Renaming the sidecar binary, the Rust commands, or `qwen3-asr.ts`. Deferred per §3.
- Holding both models resident simultaneously. Deferred per §3.
- `ParakeetStreamingASR` (EOU 120M) and `Nemotron-Speech-Streaming`, both already in
  `speech-swift`. These are for live word-by-word captions, a different feature from
  batch-after-stop dictation. If live captions become the goal, that is its own spec.
- `Omnilingual CTC 300M` (1672 languages, 384MB, fastest in the benchmark at 4.26% WER)
  and `WhisperASR` native (best accuracy-per-RAM at 1.40% WER). Both are one-line
  `Package.swift` additions once this pattern exists, and both are worth revisiting
  after Parakeet proves the multi-engine plumbing.
- Any change to Pro/trial gating. Local models are free on all tiers and stay that way.

## 6. Review

To be completed at implementation time.
