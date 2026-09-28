import {
	PARAKEET_V2_SUPPORTED_LANGUAGES,
	PARAKEET_V3_SUPPORTED_LANGUAGES,
} from '$lib/constants/languages';
import { NoteFluxErr, type NoteFluxError } from '$lib/result';
import { version as osVersion } from '@tauri-apps/plugin-os';
import { join, tempDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { remove, writeFile } from '@tauri-apps/plugin-fs';
import { Err, Ok, type Result, tryAsync } from 'wellcrafted/result';

// In-process sidecar, same shape as qwen3-asr.ts — see qwen3-asr-cli/parakeet-cli
// for the Swift binaries and lib.rs for the Rust daemon management. No HTTP
// server: each model is loaded by a persistent sidecar process invoked
// directly through Tauri, exactly like Qwen3-ASR's two model sizes already
// work today. That sidesteps the "can a shared server switch models
// per-request" problem entirely — there's no shared server.
export type ParakeetService = ReturnType<typeof createParakeetService>;

let cachedMacOSMajorVersion: number | null = null;
const verifiedDownloadedModels = new Set<string>();
const warmingUpModels = new Set<string>();

export function isParakeetWarmingUp(modelId: string): boolean {
	return warmingUpModels.has(modelId);
}

export type ParakeetModelStatus = 'downloaded' | 'not_downloaded';

export const PARAKEET_MODELS = [
	{
		id: 'parakeet-v2',
		label: 'Parakeet v2',
		size: '~2.47GB',
		ram: '~3GB',
		description: 'English only · fastest, lowest hang risk',
	},
	{
		id: 'parakeet-v3',
		label: 'Parakeet v3',
		size: '~2.51GB',
		ram: '~3GB',
		description: 'Multilingual · 25 European languages, auto-detect',
	},
] as const;

export type ParakeetModelId = (typeof PARAKEET_MODELS)[number]['id'];

export const DEFAULT_PARAKEET_MODEL_ID: ParakeetModelId = 'parakeet-v2';

function supportedLanguagesFor(modelId: ParakeetModelId): readonly string[] {
	return modelId === 'parakeet-v3'
		? PARAKEET_V3_SUPPORTED_LANGUAGES
		: PARAKEET_V2_SUPPORTED_LANGUAGES;
}

export function createParakeetService() {
	return {
		/**
		 * Returns true if the current macOS version supports Parakeet (15+).
		 * MLX/Metal shaders require macOS 15 (Sequoia) — same constraint as Qwen3-ASR.
		 */
		async isMacOSSupported(): Promise<boolean> {
			try {
				const ver = await osVersion();
				const major = parseInt(ver.split('.')[0], 10);
				return major >= 15;
			} catch {
				return false;
			}
		},

		/**
		 * Checks whether the model weights are cached on disk for a given model.
		 */
		async getModelStatus(modelId: ParakeetModelId): Promise<ParakeetModelStatus> {
			try {
				return await invoke<ParakeetModelStatus>('parakeet_model_status', { modelId });
			} catch {
				return 'not_downloaded';
			}
		},

		/**
		 * Downloads the specified model, reporting real byte-based progress (0-100).
		 */
		async downloadModel(
			modelId: ParakeetModelId,
			onProgress: (percent: number) => void,
		): Promise<Result<void, NoteFluxError>> {
			const unlisten = await listen<number>(
				'parakeet-download-progress',
				(event) => onProgress(event.payload),
			);

			const result = await tryAsync({
				mapErr: (error) =>
					NoteFluxErr({
						title: '📥 Model download failed',
						description:
							error instanceof Error
								? error.message
								: typeof error === 'string'
									? error
									: 'Could not download the model. Check your internet connection and try again.',
						action: { error, type: 'more-details' },
					}),
				try: () => invoke<void>('download_parakeet_model', { modelId }),
			});

			unlisten();
			return result;
		},

		/**
		 * Deletes the cached model weights from disk and shuts down the daemon.
		 */
		async deleteModel(modelId: ParakeetModelId): Promise<Result<void, NoteFluxError>> {
			const result = await tryAsync({
				mapErr: (error) =>
					NoteFluxErr({
						title: '🗑️ Model delete failed',
						description:
							error instanceof Error
								? error.message
								: 'Could not delete the model from disk.',
						action: { error, type: 'more-details' },
					}),
				try: () => invoke<void>('delete_parakeet_model', { modelId }),
			});
			if (result.data !== undefined) verifiedDownloadedModels.delete(modelId);
			return result;
		},

		/**
		 * Kills the daemon, freeing model weights from RAM.
		 * Call when switching away from Parakeet. Fire-and-forget.
		 */
		shutdown(): void {
			invoke('shutdown_parakeet').catch(() => {});
		},

		/**
		 * Warms up the daemon for a given model so the first transcription is instant.
		 * Returns a promise that resolves when the daemon is ready (or rejects on error).
		 */
		async preload(modelId: ParakeetModelId): Promise<void> {
			const status = await invoke<ParakeetModelStatus>('parakeet_model_status', { modelId });
			if (status === 'downloaded') {
				warmingUpModels.add(modelId);
				try {
					await invoke('preload_parakeet', { modelId });
				} finally {
					warmingUpModels.delete(modelId);
				}
			}
		},

		async transcribe(
			audioBlob: Blob,
			options: { outputLanguage: string; modelId: ParakeetModelId },
		): Promise<Result<string, NoteFluxError>> {
			try {
				if (cachedMacOSMajorVersion === null) {
					cachedMacOSMajorVersion = parseInt((await osVersion()).split('.')[0], 10);
				}
				if (cachedMacOSMajorVersion < 15) {
					return NoteFluxErr({
						title: '⚙️ macOS 15+ required',
						description:
							'Parakeet requires macOS 15 (Sequoia) or newer. Switch to a cloud transcription service.',
						action: {
							href: '/settings/transcription',
							label: 'Open Settings',
							type: 'link',
						},
					});
				}
			} catch {}

			if (!verifiedDownloadedModels.has(options.modelId)) {
				try {
					const status = await invoke<ParakeetModelStatus>('parakeet_model_status', {
						modelId: options.modelId,
					});
					if (status !== 'downloaded') {
						return NoteFluxErr({
							title: '📥 Model not downloaded',
							description: 'The Parakeet model needs to be downloaded before use.',
							action: {
								href: '/settings/transcription',
								label: 'Download Model',
								type: 'link',
							},
						});
					}
					verifiedDownloadedModels.add(options.modelId);
				} catch {}
			}

			const audioPath = await join(await tempDir(), `parakeet_${Date.now()}.wav`);

			const { error: writeError } = await tryAsync({
				mapErr: (error) =>
					NoteFluxErr({
						title: '📄 Failed to write audio',
						description: 'Could not write temp audio file for local transcription.',
						action: { error, type: 'more-details' },
					}),
				try: async () => {
					const bytes = new Uint8Array(await audioBlob.arrayBuffer());
					await writeFile(audioPath, bytes);
				},
			});

			if (writeError) return Err(writeError);

			// v2 is English-only: anything other than 'en' falls back to auto (which
			// v2 treats as English anyway). v3 validates against its 25-language list.
			const language =
				options.outputLanguage !== 'auto' &&
				supportedLanguagesFor(options.modelId).includes(options.outputLanguage)
					? options.outputLanguage
					: null;

			const { data: transcript, error: invokeError } = await tryAsync({
				mapErr: (error) =>
					NoteFluxErr({
						title: '🎙️ Parakeet failed',
						description:
							error instanceof Error
								? error.message
								: 'Local transcription failed. Ensure macOS 15+ is running.',
						action: { error, type: 'more-details' },
					}),
				try: () =>
					invoke<string>('transcribe_parakeet', {
						audioPath,
						language,
						modelId: options.modelId,
					}),
			});

			remove(audioPath).catch(() => {});

			if (invokeError) return Err(invokeError);

			if (!transcript.trim()) {
				return NoteFluxErr({
					title: '🔇 No speech detected',
					description: 'The recording appears to be silent or too short.',
				});
			}

			return Ok(transcript.trim());
		},
	};
}

export const ParakeetServiceLive = createParakeetService();
