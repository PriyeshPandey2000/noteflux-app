# Opus compression for cloud transcription uploads

Cloud transcription was slow because the Rust recorder writes uncompressed 32-bit float WAV (~64 KB/s at 16 kHz). On a ~2 Mbps uplink a 30s clip took ~4-5s just to upload, and the proxy's 4 MB body limit was hit after ~62s.

## Todo
- [x] Benchmark formats and Opus settings against Groq (see Review)
- [x] Rust: `src-tauri/src/opus_encoder.rs` (WAV in, Ogg/Opus out) + `encode_opus` Tauri command
- [x] JS: `compressForUpload()` in `services/transcription/_compress.ts`, called from `groq.ts`
- [x] Test in the built desktop app (40s clip at 44.1 kHz: 7004 KB -> 123 KB)
- [ ] Verify Windows/Linux CI builds (libopus builds from bundled source via cmake)
- [x] Warm-up request on recording start (desktop) + warm-up/preflight cache (website PR)
- [ ] Release a new desktop version

## Review
Benchmarks (Groq whisper-large-v3-turbo, India uplink, real round trips):
- 100s clip direct to Groq: f32 WAV 13.1s, s16 WAV 10.5s, FLAC 4.2s, Opus 24k 1.05s.
- 27s clip through noteflux.app proxy: f32 WAV 5.3s median (3.3-7.8s) vs Rust-encoded Opus 0.67s median.
- Accuracy: 73 LibriSpeech utterances (~1150 words), pink noise added. WER vs reference: WAV 1.39%, Opus 16-48 kbps 0.35-1.4%. Bitrate and application mode are indistinguishable within noise; chose Audio mode at 24 kbps (~22 min under the 4 MB limit).
- Rust encoder: ~7 ms per second of audio in a debug build.

Decisions and limits:
- Encodes in Rust from the in-memory WAV blob (raw IPC), so no file-path coupling and it also applies to the BYOK Groq path.
- Opus only accepts 8/12/16/24/48 kHz. Other rates (the recorder often ends up at 44.1 kHz) are resampled to 16 kHz in Rust with a small windowed-sinc filter (filter phases precomputed). Found when a 40s clip at 44.1 kHz fell back to a 7 MB WAV: WER on 44.1 kHz input is 1.04% vs 0.9-1.4% for 16 kHz input, 81 MB -> 1.4 MB.
- Opus complexity 4: ~4x faster than default 10 at the same size. Whole pipeline ~1.9 ms per second of audio (release build).
- Any encode failure (not a WAV, empty audio) falls back to the original WAV.
- Website (`noteflux--`) needs no change: the proxy already accepts Ogg/Opus. It hardcodes the filename `recording.webm`; harmless today because Groq sniffs content.
- Not yet verified: Windows and Linux builds, full app run.

## Round 2: cold start (from a real 40s run on the built app)
- Opus works in the app: 7004 KB -> 123 KB in 120 ms.
- First request after idle: total 3427 ms (upload+overhead 2660, auth 421). Immediately after: total 1979 ms (upload+overhead 1298, auth 338). The ~1.4s difference is cold start (edge instance, TLS, JWKS).
- Tauri's http plugin builds a new reqwest client per request, so it can't reuse connections; skipping the preflight with it would trade ~0.1s for a new TLS handshake. Kept the webview fetch.
- Desktop: `groq.warmUp()` fires a GET at the proxy when recording starts, only for Pro users on the cloud path, and skips it if the proxy was contacted in the last 2 minutes (a real upload warms it too).
- Website `noteflux--/app/api/groq/transcribe/route.ts`: new `GET` warm-up handler (verifies the token to warm the JWKS cache) and `Access-Control-Max-Age: 600` so the preflight is cached. Needs a Vercel deploy; the desktop app degrades gracefully without it.
- Remaining cost on this uplink: ~1s to upload 123 KB. Next lever would be a lower bitrate (16 kbps scored the same on the corpus) or uploading while recording.
