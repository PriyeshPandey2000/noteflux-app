//! Encodes a WAV recording to Ogg/Opus so cloud uploads are ~25x smaller.
//!
//! The desktop recorder writes uncompressed 32-bit float WAV (~64 KB/s at
//! 16 kHz). Uploading that over a home connection is the dominant cost of cloud
//! transcription and trips the 4 MB proxy body limit after about a minute.
//! Opus at 24 kbps is ~3 KB/s (about 22 minutes under the 4 MB limit). On 73
//! LibriSpeech utterances with added mic noise, 16-48 kbps all scored 0.4-1.4%
//! WER against the reference text, the same as uncompressed WAV.

use ogg::writing::{PacketWriteEndInfo, PacketWriter};
use opus::{Application, Bitrate, Channels, Encoder};

const OPUS_BITRATE_BPS: i32 = 24_000;
const FRAME_MS: usize = 20;
// Opus only accepts these input rates. Anything else (the recorder can pick
// 44.1 kHz) is resampled to 16 kHz, which is what Whisper uses internally.
const OPUS_RATES: [u32; 5] = [8_000, 12_000, 16_000, 24_000, 48_000];
const FALLBACK_RATE: u32 = 16_000;
// Sinc zero-crossings on each side of the resampling kernel.
const RESAMPLE_LOBES: f32 = 16.0;
// Ogg Opus granule positions are always counted at 48 kHz.
const GRANULE_RATE: u64 = 48_000;
const SERIAL: u32 = 0x4e46_5800;

struct Pcm {
    sample_rate: u32,
    mono: Vec<f32>,
}

fn read_u16(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn read_u32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// Parses a PCM16 or IEEE-float32 WAV and downmixes to mono. The recorder
/// writes placeholder chunk sizes while recording, so the data chunk length is
/// clamped to the bytes actually present.
fn parse_wav(bytes: &[u8]) -> Result<Pcm, String> {
    if bytes.get(0..4) != Some(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {
        return Err("Not a WAV file".into());
    }

    let (mut format, mut channels, mut sample_rate, mut bits) = (0u16, 0u16, 0u32, 0u16);
    let mut pos = 12;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = read_u32(bytes, pos + 4).ok_or("Truncated WAV")? as usize;
        let body = pos + 8;

        if id == b"fmt " {
            format = read_u16(bytes, body).ok_or("Truncated fmt chunk")?;
            channels = read_u16(bytes, body + 2).ok_or("Truncated fmt chunk")?;
            sample_rate = read_u32(bytes, body + 4).ok_or("Truncated fmt chunk")?;
            bits = read_u16(bytes, body + 14).ok_or("Truncated fmt chunk")?;
        } else if id == b"data" {
            let end = body.saturating_add(size).min(bytes.len());
            let data = &bytes[body..end];
            if channels == 0 {
                return Err("WAV data chunk before fmt chunk".into());
            }

            let samples: Vec<f32> = match (format, bits) {
                (3, 32) => data
                    .chunks_exact(4)
                    .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                    .collect(),
                (1, 16) => data
                    .chunks_exact(2)
                    .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0)
                    .collect(),
                _ => return Err(format!("Unsupported WAV format {format}/{bits}-bit")),
            };

            let ch = channels as usize;
            let mono = samples
                .chunks_exact(ch)
                .map(|frame| frame.iter().sum::<f32>() / ch as f32)
                .collect();
            return Ok(Pcm { sample_rate, mono });
        }

        // Chunks are word-aligned.
        pos = body.saturating_add(size).saturating_add(size & 1);
    }

    Err("WAV has no data chunk".into())
}

/// Windowed-sinc resampler (Hann window, low-pass at 90% of the output
/// Nyquist so downsampling doesn't alias). Output sample `n` sits at input
/// position `n * from / to`; the fractional part only takes `to / gcd` distinct
/// values, so each phase's filter is computed once up front.
fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    fn gcd(a: u32, b: u32) -> u32 {
        if b == 0 { a } else { gcd(b, a % b) }
    }
    let g = gcd(from, to);
    let (step, phases) = ((from / g) as usize, (to / g) as usize);

    let ratio = from as f64 / to as f64;
    let cutoff = (0.45 / ratio.max(1.0)) as f32; // cycles per input sample
    let half = (RESAMPLE_LOBES / (2.0 * cutoff)).ceil() as isize;
    let taps = 2 * half as usize;

    let filters: Vec<Vec<f32>> = (0..phases)
        .map(|phase| {
            let frac = phase as f32 / phases as f32;
            let mut w: Vec<f32> = (0..taps)
                .map(|j| {
                    let x = (j as isize - half + 1) as f32 - frac;
                    let arg = 2.0 * std::f32::consts::PI * cutoff * x;
                    let sinc = if x == 0.0 { 1.0 } else { arg.sin() / arg };
                    let hann = 0.5 + 0.5 * (std::f32::consts::PI * x / half as f32).cos();
                    sinc * hann
                })
                .collect();
            let sum: f32 = w.iter().sum();
            w.iter_mut().for_each(|v| *v /= sum);
            w
        })
        .collect();

    let out_len = (input.len() as f64 / ratio) as usize;
    (0..out_len)
        .map(|n| {
            let pos = n * step;
            let base = (pos / phases) as isize;
            let filter = &filters[pos % phases];
            let first = base - half + 1;
            let mut acc = 0.0f32;
            for (j, w) in filter.iter().enumerate() {
                let k = first + j as isize;
                if k >= 0 && (k as usize) < input.len() {
                    acc += input[k as usize] * w;
                }
            }
            acc
        })
        .collect()
}

/// Returns Ogg/Opus bytes, or an error if the input isn't a usable WAV (the
/// caller then uploads the WAV unchanged).
pub fn wav_to_ogg_opus(wav: &[u8]) -> Result<Vec<u8>, String> {
    let mut pcm = parse_wav(wav)?;
    if pcm.mono.is_empty() {
        return Err("Recording is empty".into());
    }
    if !OPUS_RATES.contains(&pcm.sample_rate) {
        pcm.mono = resample(&pcm.mono, pcm.sample_rate, FALLBACK_RATE);
        pcm.sample_rate = FALLBACK_RATE;
    }

    let rate = pcm.sample_rate;
    // Audio mode scored as well as or better than VoIP mode at the same bitrate.
    let mut encoder = Encoder::new(rate, Channels::Mono, Application::Audio)
        .map_err(|e| format!("Opus init failed: {e}"))?;
    encoder
        .set_bitrate(Bitrate::Bits(OPUS_BITRATE_BPS))
        .map_err(|e| format!("Opus bitrate failed: {e}"))?;
    encoder.set_vbr(true).map_err(|e| format!("Opus VBR failed: {e}"))?;
    // Complexity 4 encodes ~4x faster than the default 10 for the same size
    // (measured 22 ms vs 92 ms per 12.5 s of speech).
    encoder
        .set_complexity(4)
        .map_err(|e| format!("Opus complexity failed: {e}"))?;

    let to_granule = |samples: u64| samples * GRANULE_RATE / rate as u64;
    let pre_skip = to_granule(
        encoder
            .get_lookahead()
            .map_err(|e| format!("Opus lookahead failed: {e}"))? as u64,
    );

    let mut out = Vec::new();
    {
        let mut writer = PacketWriter::new(&mut out);

        let mut head = Vec::with_capacity(19);
        head.extend_from_slice(b"OpusHead");
        head.push(1); // version
        head.push(1); // channels
        head.extend_from_slice(&(pre_skip as u16).to_le_bytes());
        head.extend_from_slice(&rate.to_le_bytes());
        head.extend_from_slice(&0i16.to_le_bytes()); // output gain
        head.push(0); // channel mapping family
        writer
            .write_packet(head, SERIAL, PacketWriteEndInfo::EndPage, 0)
            .map_err(|e| format!("Ogg write failed: {e}"))?;

        let vendor = b"noteflux";
        let mut tags = Vec::new();
        tags.extend_from_slice(b"OpusTags");
        tags.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
        tags.extend_from_slice(vendor);
        tags.extend_from_slice(&0u32.to_le_bytes()); // no user comments
        writer
            .write_packet(tags, SERIAL, PacketWriteEndInfo::EndPage, 0)
            .map_err(|e| format!("Ogg write failed: {e}"))?;

        let frame_len = rate as usize * FRAME_MS / 1000;
        let total = pcm.mono.len();
        let frame_count = total.div_ceil(frame_len);
        let mut packet = [0u8; 4000];
        let mut frame = vec![0f32; frame_len];

        for i in 0..frame_count {
            let start = i * frame_len;
            let end = (start + frame_len).min(total);
            frame[..end - start].copy_from_slice(&pcm.mono[start..end]);
            frame[end - start..].fill(0.0);

            let n = encoder
                .encode_float(&frame, &mut packet)
                .map_err(|e| format!("Opus encode failed: {e}"))?;

            let is_last = i + 1 == frame_count;
            // The last granule is the true sample count so the decoder trims
            // the zero padding added to fill the final frame.
            let granule = pre_skip + to_granule(if is_last { total } else { end } as u64);
            let end_info = if is_last {
                PacketWriteEndInfo::EndStream
            } else {
                PacketWriteEndInfo::NormalPacket
            };
            writer
                .write_packet(packet[..n].to_vec(), SERIAL, end_info, granule)
                .map_err(|e| format!("Ogg write failed: {e}"))?;
        }
    }

    Ok(out)
}

/// Receives raw WAV bytes from the webview and returns raw Ogg/Opus bytes.
/// Errors mean "send the WAV as-is"; the caller treats them as non-fatal.
#[tauri::command]
pub async fn encode_opus(request: tauri::ipc::Request<'_>) -> Result<tauri::ipc::Response, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw WAV bytes".into());
    };
    let wav = bytes.clone();
    let ogg = tauri::async_runtime::spawn_blocking(move || wav_to_ogg_opus(&wav))
        .await
        .map_err(|e| format!("Encoder task failed: {e}"))??;
    Ok(tauri::ipc::Response::new(ogg))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav_f32(rate: u32, channels: u16, samples: &[f32]) -> Vec<u8> {
        let data_len = (samples.len() * 4) as u32;
        let mut b = Vec::new();
        b.extend_from_slice(b"RIFF");
        b.extend_from_slice(&(36 + data_len).to_le_bytes());
        b.extend_from_slice(b"WAVEfmt ");
        b.extend_from_slice(&16u32.to_le_bytes());
        b.extend_from_slice(&3u16.to_le_bytes());
        b.extend_from_slice(&channels.to_le_bytes());
        b.extend_from_slice(&rate.to_le_bytes());
        b.extend_from_slice(&(rate * channels as u32 * 4).to_le_bytes());
        b.extend_from_slice(&(channels * 4).to_le_bytes());
        b.extend_from_slice(&32u16.to_le_bytes());
        b.extend_from_slice(b"data");
        b.extend_from_slice(&data_len.to_le_bytes());
        for s in samples {
            b.extend_from_slice(&s.to_le_bytes());
        }
        b
    }

    fn tone(rate: u32, secs: f32) -> Vec<f32> {
        (0..(rate as f32 * secs) as usize)
            .map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / rate as f32).sin() * 0.3)
            .collect()
    }

    #[test]
    fn encodes_16k_mono_to_small_ogg() {
        let wav = wav_f32(16_000, 1, &tone(16_000, 2.0));
        let ogg = wav_to_ogg_opus(&wav).unwrap();
        assert_eq!(&ogg[0..4], b"OggS");
        assert!(ogg.windows(8).any(|w| w == b"OpusHead"));
        assert!(ogg.len() < wav.len() / 10, "{} vs {}", ogg.len(), wav.len());
    }

    #[test]
    fn downmixes_stereo() {
        let mono = tone(48_000, 1.0);
        let stereo: Vec<f32> = mono.iter().flat_map(|s| [*s, *s]).collect();
        assert!(wav_to_ogg_opus(&wav_f32(48_000, 2, &stereo)).is_ok());
    }

    #[test]
    fn tolerates_placeholder_data_size() {
        let mut wav = wav_f32(16_000, 1, &tone(16_000, 1.0));
        let at = wav.windows(4).position(|w| w == b"data").unwrap() + 4;
        wav[at..at + 4].copy_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        assert!(wav_to_ogg_opus(&wav).is_ok());
    }

    #[test]
    fn resamples_44k_to_16k() {
        let out = resample(&tone(44_100, 1.0), 44_100, 16_000);
        assert!((out.len() as i64 - 16_000).abs() <= 1);
        // A 440 Hz tone must survive resampling at about the same amplitude.
        let peak = out[2_000..14_000].iter().fold(0f32, |m, s| m.max(s.abs()));
        assert!((peak - 0.3).abs() < 0.03, "peak {peak}");
        assert!(wav_to_ogg_opus(&wav_f32(44_100, 1, &tone(44_100, 1.0))).is_ok());
    }

    #[test]
    fn rejects_non_wav() {
        assert!(wav_to_ogg_opus(b"not a wav file at all").is_err());
    }
}
