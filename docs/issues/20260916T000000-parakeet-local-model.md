# Add Parakeet as a Faster Local Transcription Model

**Created:** 2026-09-16
**Status:** Ticket only — no code changed. Research/benchmarks already exist from a prior spike; this doc collects them so integration can start directly from here later.
**Motivation:** the current local option (Qwen3-ASR) has noticeable latency and has reportedly hung the app multiple times in practice. Local-model users generally care more about the experience being fast and snappy than about squeezing out the last bit of accuracy, so a faster model is worth adding as an alternative.

**Correction (2026-09-16):** this ticket originally pitched Parakeet as "lightweight." That's wrong — checked against what's actually in this app already (`qwen3-asr.ts`): Qwen3-ASR ships at **680MB (0.6B, 4-bit)** and **1.7GB (1.7B, 4-bit)**. Parakeet's standard build is **2.47GB, unquantized** — bigger than both existing options, not smaller. See "Size, honestly" below for the real comparison and what a smaller Parakeet build would cost you.

## Why Parakeet

**Final recommendation (2026-09-16): offer both v2 and v3 as separate picker options.** This ticket went back and forth (v2 only → v3 only → both → v3 only → both again) — locking it here, not revisiting again. Reasoning: some users only ever speak/dictate in English and don't need a model carrying capacity for 24 languages they'll never use; giving them a dedicated English build (v2, marginally better English WER at 6.05% vs v3's 6.34%) alongside the multilingual build (v3) covers both audiences honestly, same as Qwen3-ASR already offers 0.6B vs 1.7B as a size/accuracy choice today.

- `nvidia/parakeet-tdt-0.6b-v2` (MLX: `mlx-community/parakeet-tdt-0.6b-v2`) — **English** option
- `nvidia/parakeet-tdt-0.6b-v3` (MLX: `mlx-community/parakeet-tdt-0.6b-v3`) — **Multilingual** option, 25 European languages with automatic detection, no extra prompting required
- Both are 2.47GB, same speed class — the only difference is language coverage, not size or latency
- Real apps already ship v3 in production: **VoiceInk, MacWhisper, Spokenly, and Handy**. (Source: web search, September 2026 — [mlx-community/parakeet-tdt-0.6b-v3 on Hugging Face](https://huggingface.co/mlx-community/parakeet-tdt-0.6b-v3), [nvidia/parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), [senstella/parakeet-mlx](https://github.com/senstella/parakeet-mlx).)

- Size: 2.47GB on disk each (a user who installs both is using ~4.94GB) — see "Size, honestly" below, this is the weak point
- Platform: **Apple Silicon only** (MLX/Metal)
- Language: v2 = English only. v3 = 25 European languages with auto-detect.
- License: CC-BY-4.0 (requires attribution in the app's licenses screen)

## Size, honestly

| Model | Size | Quantization | Maintainer | Proven in production? |
|---|---|---|---|---|
| Qwen3-ASR 0.6B (current app default) | ~680MB | 4-bit | `aufklarer` | Yes — already shipping in this app |
| Qwen3-ASR 1.7B (current app option) | ~1.7GB | 4-bit | `mlx-community` | Yes — already shipping in this app |
| **Parakeet v2, standard build (English)** | **2.47GB** | none (BF16) | `mlx-community` | Yes — the English-only build most local apps ship |
| **Parakeet v3, standard build (Multilingual)** | **2.47GB** | none (BF16) | `mlx-community` | Yes — VoiceInk, MacWhisper, Spokenly, Handy all ship this exact build |
| Parakeet v3, 8-bit quant | ~909MB | 8-bit | `animaslabs` (individual HF account) | No — no known production app ships this |
| Parakeet v2, 8-bit quant | ~778MB | 8-bit | `kyr0` (individual HF account) | No — no known production app ships this |

Parakeet's standard build is the *largest* option on the table, not the lightest — bigger than both Qwen3-ASR variants already in the app. Smaller 8-bit quantized Parakeet builds exist and would undercut Qwen3-ASR 1.7B on size, but they come from individual community HF accounts, not `nvidia`/`mlx-community`, with no track record and no guarantee the quantization holds accuracy or gets maintained. The 2.47GB build is the one with real adoption evidence.

So the honest pitch for Parakeet isn't "smaller file" — it's **lower inference latency and less hang risk** (the benchmarks below: ~120–170ms warm latency vs. Qwen3-ASR's reported hangs) plus, with v3, multilingual support Qwen3-ASR may or may not match feature-for-feature. If on-disk size is the deciding factor, either stick with Qwen3-ASR 0.6B, or someone needs to actually validate one of the unofficial 8-bit Parakeet quants (WER check against the benchmarks below) before it's trustworthy to ship.

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

**Phase 1 — manual server setup (low effort):** the codebase already has a `speaches.ts` provider that talks to a self-hosted OpenAI-compatible `/v1/audio/transcriptions` endpoint. Parakeet exposes the same API via the pip-installable `riedemannai/parakeet-mlx-server`. Integration is essentially cloning `speaches.ts` → `parakeet.ts` with **two model entries**, mirroring `QWEN3_ASR_MODELS`' two-entry array in `qwen3-asr.ts`:
- Default `baseUrl`: `http://localhost:8000`
- Entry 1 — `mlx-community/parakeet-tdt-0.6b-v2`, label "Parakeet 0.6B (English)": validate `outputLanguage` is `en`/`auto` only, reject anything else before sending the request
- Entry 2 — `mlx-community/parakeet-tdt-0.6b-v3`, label "Parakeet 0.6B (Multilingual)": v3 auto-detects language across its 25 supported languages, so validate against that list instead of English-only
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
