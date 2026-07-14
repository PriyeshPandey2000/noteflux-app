import { QWEN3_ASR_SUPPORTED_LANGUAGES } from '$lib/constants/languages';
import { NoteFluxErr, type NoteFluxError } from '$lib/result';
import { version as osVersion } from '@tauri-apps/plugin-os';
import { join, tempDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { remove, writeFile } from '@tauri-apps/plugin-fs';
import { Err, Ok, type Result, tryAsync } from 'wellcrafted/result';

export type Qwen3ASRService = ReturnType<typeof createQwen3ASRService>;

let cachedMacOSMajorVersion: number | null = null;
const verifiedDownloadedModels = new Set<string>();
const warmingUpModels = new Set<string>();

export function isQwen3WarmingUp(modelId: string): boolean {
	return warmingUpModels.has(modelId);
}

export type Qwen3ASRModelStatus = 'downloaded' | 'not_downloaded';

export const QWEN3_ASR_MODELS = [
	{
		id: 'aufklarer/Qwen3-ASR-0.6B-MLX-4bit',
		label: 'Qwen3-ASR 0.6B',
		size: '~680MB',
		ram: '~1GB',
		description: 'Fast · good accuracy',
	},
	{
		id: 'mlx-community/Qwen3-ASR-1.7B-4bit',
		label: 'Qwen3-ASR 1.7B',
		size: '~1.7GB',
		ram: '~2GB',
		description: 'Best accuracy · beats Whisper large-v3',
	},
] as const;

export type Qwen3ASRModelId = (typeof QWEN3_ASR_MODELS)[number]['id'];

export const DEFAULT_QWEN3_ASR_MODEL_ID: Qwen3ASRModelId =
	'aufklarer/Qwen3-ASR-0.6B-MLX-4bit';

export function createQwen3ASRService() {
	return {
		/**
		 * Returns true if the current macOS version supports Qwen3-ASR (15+).
		 * MLX Metal shaders require macOS 15 (Sequoia).
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
		async getModelStatus(modelId: Qwen3ASRModelId): Promise<Qwen3ASRModelStatus> {
			try {
				return await invoke<Qwen3ASRModelStatus>('qwen3_asr_model_status', { modelId });
			} catch {
				return 'not_downloaded';
			}
		},

		/**
		 * Downloads the specified model, reporting real byte-based progress (0-100).
		 */
		async downloadModel(
			modelId: Qwen3ASRModelId,
			onProgress: (percent: number) => void,
		): Promise<Result<void, NoteFluxError>> {
			const unlisten = await listen<number>(
				'qwen3-asr-download-progress',
				(event) => onProgress(event.payload),
			);

			const result = await tryAsync({
				mapErr: (error) =>
					NoteFluxErr({
						title: '📥 Model download failed',
						description:
							error instanceof Error
								? error.message
								: 'Could not download the model. Check your internet connection and try again.',
						action: { error, type: 'more-details' },
					}),
				try: () => invoke<void>('download_qwen3_asr_model', { modelId }),
			});

			unlisten();
			return result;
		},

		/**
		 * Deletes the cached model weights from disk and shuts down the daemon.
		 */
		async deleteModel(modelId: Qwen3ASRModelId): Promise<Result<void, NoteFluxError>> {
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
				try: () => invoke<void>('delete_qwen3_asr_model', { modelId }),
			});
			if (result.data !== undefined) verifiedDownloadedModels.delete(modelId);
			return result;
		},

		/**
		 * Kills the daemon, freeing model weights from RAM.
		 * Call when switching away from Qwen3ASR. Fire-and-forget.
		 */
		shutdown(): void {
			invoke('shutdown_qwen3_asr').catch(() => {});
		},

		/**
		 * Warms up the daemon for a given model so the first transcription is instant.
		 * Returns a promise that resolves when the daemon is ready (or rejects on error).
		 */
		async preload(modelId: Qwen3ASRModelId): Promise<void> {
			const status = await invoke<Qwen3ASRModelStatus>('qwen3_asr_model_status', { modelId });
			if (status === 'downloaded') {
				warmingUpModels.add(modelId);
				try {
					await invoke('preload_qwen3_asr', { modelId });
				} finally {
					warmingUpModels.delete(modelId);
				}
			}
		},

		async transcribe(
			audioBlob: Blob,
			options: { outputLanguage: string; modelId: Qwen3ASRModelId },
		): Promise<Result<string, NoteFluxError>> {
			try {
				if (cachedMacOSMajorVersion === null) {
					cachedMacOSMajorVersion = parseInt((await osVersion()).split('.')[0], 10);
				}
				if (cachedMacOSMajorVersion < 15) {
					return NoteFluxErr({
						title: '⚙️ macOS 15+ required',
						description:
							'Qwen3-ASR requires macOS 15 (Sequoia) or newer. Switch to a cloud transcription service.',
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
					const status = await invoke<Qwen3ASRModelStatus>('qwen3_asr_model_status', {
						modelId: options.modelId,
					});
					if (status !== 'downloaded') {
						return NoteFluxErr({
							title: '📥 Model not downloaded',
							description: 'The Qwen3-ASR model needs to be downloaded before use.',
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

			const audioPath = await join(await tempDir(), `qwen3asr_${Date.now()}.wav`);

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

			const language =
				options.outputLanguage !== 'auto' &&
				(QWEN3_ASR_SUPPORTED_LANGUAGES as readonly string[]).includes(
					options.outputLanguage,
				)
					? options.outputLanguage
					: null;

			const { data: transcript, error: invokeError } = await tryAsync({
				mapErr: (error) =>
					NoteFluxErr({
						title: '🎙️ Qwen3-ASR failed',
						description:
							error instanceof Error
								? error.message
								: 'Local transcription failed. Ensure macOS 15+ is running.',
						action: { error, type: 'more-details' },
					}),
				try: () =>
					invoke<string>('transcribe_qwen3_asr', {
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

export const Qwen3ASRServiceLive = createQwen3ASRService();
