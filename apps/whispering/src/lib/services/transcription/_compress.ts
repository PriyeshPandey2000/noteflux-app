import { invoke } from '@tauri-apps/api/core';

/**
 * The desktop recorder writes uncompressed 32-bit float WAV (~64 KB/s). On a
 * typical home uplink that upload is most of the cloud transcription latency,
 * and it hits the proxy's 4 MB limit after about a minute. The Rust
 * `encode_opus` command turns it into Ogg/Opus (~3 KB/s).
 *
 * Returns the original blob when not running in Tauri, when it isn't a WAV, or
 * when encoding fails (e.g. a 44.1 kHz recording), so callers always get
 * something uploadable.
 */
export async function compressForUpload(blob: Blob): Promise<Blob> {
	if (!window.__TAURI_INTERNALS__ || !blob.type.includes('wav')) return blob;

	const start = performance.now();
	try {
		const wav = new Uint8Array(await blob.arrayBuffer());
		const ogg = await invoke<ArrayBuffer>('encode_opus', wav);
		console.log(
			`[Opus] ${(blob.size / 1024).toFixed(0)}KB -> ${(ogg.byteLength / 1024).toFixed(0)}KB in ${(performance.now() - start).toFixed(0)}ms`,
		);
		return new Blob([ogg], { type: 'audio/ogg' });
	} catch (error) {
		console.warn('[Opus] Encoding failed, uploading original audio:', error);
		return blob;
	}
}
