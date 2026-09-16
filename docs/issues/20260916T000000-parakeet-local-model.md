# Add Parakeet as a Faster Local Transcription Model

**Created:** 2026-09-16
**Status:** Ticket only — no code changed. Research/benchmarks already exist from a prior spike; this doc collects them so integration can start directly from here later.
**Motivation:** the current local option (Qwen3-ASR) has noticeable latency and has reportedly hung the app multiple times in practice. Local-model users generally care more about the experience being fast and snappy than about squeezing out the last bit of accuracy, so a faster model is worth adding as an alternative.

**Correction (2026-09-16):** this ticket originally pitched Parakeet as "lightweight." That's wrong — checked against what's actually in this app already (`qwen3-asr.ts`): Qwen3-ASR ships at **680MB (0.6B, 4-bit)** and **1.7GB (1.7B, 4-bit)**. Parakeet's standard build is **2.47GB, unquantized** — bigger than both existing options, not smaller. See "Size, honestly" below for the real comparison and what a smaller Parakeet build would cost you.

## Why Parakeet

**Final recommendation (2026-09-16): offer both v2 and v3 as separate picker options.** This ticket went back and forth (v2 only → v3 only → both → v3 only → both again) — locking it here, not revisiting again. Reasoning: some users only ever speak/dictate in English and don't need a model carrying capacity for 24 languages they'll never use; giving them a dedicated English build (v2, marginally better English WER at 6.05% vs v3's 6.34%) alongside the multilingual build (v3) covers both audiences honestly, same as Qwen3-ASR already offers 0.6B vs 1.7B as a size/accuracy choice today.

- `nvidia/parakeet-tdt-0.6b-v2` (MLX: `mlx-community/parakeet-tdt-0.6b-v2`) — **English** option
- `nvidia/parakeet-tdt-0.6b-v3` (MLX: `mlx-community/parakeet-tdt-0.6b-v3`) — **Multilingual** option, 25 European languages with automatic detection, no extra prompting required
- v2 is 2.47GB, v3 is 2.51GB (confirmed on the Hugging Face file pages — not a GB/GiB rounding difference, v3 is genuinely a bit bigger), same speed class — the difference is language coverage, not meaningfully size or latency
- Real apps already ship Parakeet v3 *support* in production: **VoiceInk, MacWhisper, Spokenly, and Handy**. Caveat — not all of them use the `mlx-community` MLX artifact this ticket targets; MacWhisper and Spokenly specifically ship a smaller CoreML build instead (see "Size, honestly" below for the correction and what that implies). (Source: web search, September 2026 — [mlx-community/parakeet-tdt-0.6b-v3 on Hugging Face](https://huggingface.co/mlx-community/parakeet-tdt-0.6b-v3), [nvidia/parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), [senstella/parakeet-mlx](https://github.com/senstella/parakeet-mlx).)

- Size: v2 is 2.47GB, v3 is 2.51GB (a user who installs both is using ~4.98GB) — see "Size, honestly" below, this is the weak point
- Platform: **Apple Silicon only** (MLX/Metal)
- Language: v2 = English only. v3 = 25 European languages with auto-detect.
- License: CC-BY-4.0 (requires attribution in the app's licenses screen)

## Size, honestly

| Model | Size | Quantization | Maintainer | Proven in production? |
|---|---|---|---|---|
| Qwen3-ASR 0.6B (current app default) | ~680MB | 4-bit | `aufklarer` | Yes — already shipping in this app |
| Qwen3-ASR 1.7B (current app option) | ~1.7GB | 4-bit | `mlx-community` | Yes — already shipping in this app |
| **Parakeet v2, standard MLX build (English)** | **2.47GB** | none (BF16) | `mlx-community` | Yes — the MLX weights this ticket's Phase 1 plan targets |
| **Parakeet v3, standard MLX build (Multilingual)** | **2.51GB** | none (BF16) | `mlx-community` | Partially — see correction below, not all cited apps ship this exact artifact |
| Parakeet v3, 8-bit MLX quant | ~909MB | 8-bit | `animaslabs` (individual HF account) | No — no known production app ships this |
| Parakeet v2, 8-bit MLX quant | ~778MB | 8-bit | `kyr0` (individual HF account) | No — no known production app ships this |
| Parakeet v3, CoreML build (`parakeet-pro`) | **494MB** | CoreML/ANE-optimized | Argmax (`argmaxinc/parakeetkit-pro`) | Yes — this is what MacWhisper actually ships |

**Correction on the adoption claim:** an earlier version of this ticket said "VoiceInk, MacWhisper, Spokenly, and Handy all ship this exact build," meaning the 2.47/2.51GB `mlx-community` MLX safetensors. That's not accurate for at least two of them — MacWhisper ships a **494MB CoreML build** (`parakeet-pro:nvidia_parakeet-v3_494MB`, built with Argmax, running on the Neural Engine, not MLX/GPU), and Spokenly documents a Core ML Parakeet v3 model too. Those apps support **Parakeet v3 the model**, not necessarily the specific MLX artifact this ticket's Phase 1 plan is built around. That CoreML/Argmax path is a real, production-proven, much smaller option — genuinely worth considering as an alternative to the MLX plan below, but it's a different runtime (CoreML/ANE via Argmax's tooling, not `parakeet-mlx`) and would change the Phase 1 integration approach, not just the model file. Flagging it here rather than redesigning the plan around it, since that's a bigger decision than this correction pass.

Parakeet's standard MLX build is still the *largest* option on the table among the MLX weights, bigger than both Qwen3-ASR variants already in the app. The unofficial 8-bit MLX quants remain unproven (individual HF accounts, no track record). The CoreML/Argmax 494MB build is the one genuinely proven-smaller option — but adopting it means building against CoreML instead of MLX, a different integration than Phase 1 below assumes.

So the honest pitch for the MLX build isn't "smaller file" — it's **lower inference latency and less hang risk** (the benchmarks below: ~120–170ms warm latency vs. Qwen3-ASR's reported hangs) plus, with v3, multilingual support Qwen3-ASR may or may not match feature-for-feature. If on-disk size is the deciding factor, the real options are: stick with Qwen3-ASR 0.6B, validate one of the unofficial 8-bit MLX quants first, or scope a separate CoreML/Argmax integration instead of the MLX plan below.

## Prior research already done (currently stuck in a stash, not on any branch)

A previous spike already benchmarked this on an M4 MacBook Pro (16GB) and wrote up an integration plan. None of it was ever committed — it's sitting untracked inside **`git stash@{7}`** ("On whisperkit: local model experiments (moonshine, parakeet)"), stashed back on the old `whisperkit` branch. It was never popped onto any branch, so it doesn't exist anywhere else in history. Whoever picks this up should pull these files out of that stash first:

- `docs/local-transcription.md` — the full writeup (benchmarks, integration path, known issues, cross-platform alternatives)
- `test_parakeet.py`, `test_parakeet_mic.py`, `test_parakeet_optimised.py`, `test_parakeet_streaming.py` — the actual benchmark/mic-test scripts
- `test_moonshine.py`, `test_moonshine.html` — equivalent scripts for the cross-platform fallback (see below)

### Headline benchmark numbers (from that spike)

| Phase | Time |
|---|---|
| Model load from HuggingFace cache | 1.7–1.8s |
| First inference, cold JIT (silence warmup) | ~589ms |
| First inference, proper warmup (speech-harmonic warmup) | ~150ms |

| Audio duration | Warm latency | RTF |
|---|---|---|
| 1s | ~120ms | 8x |
| 2s | ~141ms | 14x |
| 3s | ~169ms | 18x |
| 13.8s | ~748ms | 19x |

For comparison, this is the thing being replaced/supplemented — Qwen3-ASR is large enough to have caused app hangs, per the motivation above.

### The catch already identified

- **Hallucinates on silence without VAD — fixable, not an open bug, applies to v2 and v3 both.** This isn't a defect to debug — Parakeet is a batch transducer with no built-in speech/silence detector, so it isn't broken, it's just being asked a question ("what words are in this audio?") about audio that has no words in it, and it answers anyway. The fix is gating what reaches the model: only send it audio a separate VAD pass already confirmed contains speech. This repo already has that exact gate — `onVADMisfire` in `vad-recorder.ts`, used by other providers today — so wiring Parakeet through it is reuse, not new engineering. It must not be bypassed for either variant. Skipping this is exactly the kind of thing that would reintroduce the "large model causing hangs/glitches" experience this ticket is trying to get away from, just with a different failure mode (garbage text instead of a hang).
- **Chunked "live" streaming loses accuracy at chunk boundaries.** The recommended approach isn't true streaming — it's: run background warmup chunks *during* recording (results discarded, just to trigger MLX JIT), then transcribe the full buffer on stop. That gives ~200–400ms latency after stop with full-context accuracy, instead of true word-by-word captions (which would need a completely different architecture — `sherpa-onnx` + an online Zipformer model, not Parakeet).
- **Apple Silicon only.** Windows and Intel Mac users can't use this provider at all (v2 and v3 both — the platform constraint is MLX/Metal, not the language support). If this ships, the settings UI needs to hide the Parakeet option on unsupported platforms, and those users need a fallback (see below).

## Proposed integration path (from the prior spike, not started)

**Phase 1 — manual server setup (low effort, plan needs revising before implementation):** the codebase already has a `speaches.ts` provider that talks to a self-hosted OpenAI-compatible `/v1/audio/transcriptions` endpoint. The original version of this plan assumed Parakeet's server (`riedemannai/parakeet-mlx-server`) exposes that same generic API — send any `model`/`language` per request, get it transcribed accordingly, same as Speaches. **That's wrong, checked against the actual server code:**
- `riedemannai/parakeet-mlx-server` loads **one model at startup** (via `PARAKEET_MODEL` env var or `--model` flag), default `NeurologyAI/neuro-parakeet-mlx` — a German neurology fine-tune, not even the base `mlx-community/parakeet-tdt-0.6b-v3`. Default port is `8002`, not `8000`.
- The request body's `model` field is accepted but does **not** switch which model actually runs — whatever loaded at startup is what serves every request.
- Its transcribe call is invoked with a fixed language rather than honoring a per-request language field, so passing `outputLanguage` per request doesn't do what the original plan assumed either.

So a single shared server can't back the v2/v3 picker the way `speaches.ts`'s pattern assumes. Before implementing, pick one of:
1. **Two separate server processes, two separate ports** — one instance started with `PARAKEET_MODEL=mlx-community/parakeet-tdt-0.6b-v2` on `:8002`, another with `PARAKEET_MODEL=mlx-community/parakeet-tdt-0.6b-v3` on a different port — and give `parakeet.ts`'s two model entries distinct `baseUrl`s instead of a shared one with a `model` field.
2. **Fork/patch the server** to honor per-request model and language instead of a startup-fixed model.
3. **Find or write a different server** that's genuinely OpenAI-API-compatible for model switching (not yet identified — needs its own research pass).

Whichever is chosen, `outputLanguage` validation (v2 = `en`/`auto` only, v3 = its 25-language list) still needs to happen client-side in `parakeet.ts` before sending, same as originally planned — that part of the plan was fine, just not sufficient on its own since the server-side language handling can't be assumed to cooperate.
- Strip `temperature` from the request on both (Parakeet ignores it)

Files that would need touching: `apps/whispering/src/lib/services/transcription/parakeet.ts` (new), `.../transcription/index.ts` (export), `.../constants/transcription/service-config.ts` (registry entry).

**Phase 2 — proper UX (in-app download + auto-managed server):** in-app 2.47GB model download with progress/resume (browser fetch doesn't give that at this size — needs Tauri's download plugin or a Rust command), stored under `~/Library/Application Support/Whispering/models/parakeet/`, with a Tauri sidecar (`tauri-plugin-shell`) starting/stopping the inference server on app launch/quit, running its warmup pass before accepting requests.

## Cross-platform fallback (needed if this ships, since Parakeet is Mac-only)

| Model | Size | Platform | WER | Latency |
|---|---|---|---|---|
| Moonshine v2 Medium | ~500MB | All | 6.65% | 258ms (M3) |
| Moonshine v2 Small | ~250MB | All | 7.84% | 148ms (M3) |
| Parakeet ONNX (groxaxo Docker build) | ~670MB | All (CPU) | ~2.16% | ~17–30x RTF |
| WhisperKit large-v3-turbo | ~1.5GB | Apple Silicon | 2.2% | 460ms |
| faster-whisper + Silero VAD | varies | All | 7–9% | ~500ms |

Moonshine v2 was the prior spike's pick for the cleanest cross-platform English option; WhisperKit if multilingual is ever needed on Mac.

## Status

Not implemented. This is a ticket capturing existing research so the integration (Phase 1 above) can start directly from here whenever it's prioritized. No code was changed as part of writing this ticket.
