import { fromTaggedErr, fromTaggedError, NoteFluxErr } from '$lib/result';
import type { SelectionContext } from '$lib/services/clipboard/types';
import * as services from '$lib/services';
import { analytics } from '$lib/services/posthog';
import { auth } from '$lib/stores/auth.svelte';
import { featureTutorial } from '$lib/stores/feature-tutorial.svelte';
import { settings } from '$lib/stores/settings.svelte';
import { authRequiredDialog } from '$lib/stores/auth-required-dialog.svelte';
import { isOnboardingDemoStep } from '$lib/services/onboarding-demo-step';
import { onboardingStore } from '$lib/stores/onboarding.svelte';
import { subscription } from '$lib/stores/subscription.svelte';
import { proPricingDialog } from '$lib/stores/pro-pricing-dialog.svelte';
import { invoke } from '@tauri-apps/api/core';
import { readImage } from '@tauri-apps/plugin-clipboard-manager';
import { nanoid } from 'nanoid/non-secure';
import { Err, Ok } from 'wellcrafted/result';

import { rpc } from './';
import { defineMutation } from './_client';
import { delivery } from './delivery';
import { notify } from './notify';
import { recorder } from './recorder';
import { recordings } from './recordings';
import { sound } from './sound';
import { transcription } from './transcription';
import { transformations } from './transformations';
import { transformer } from './transformer';
import { vadRecorder } from './vad-recorder';

/**
 * Hides the recording overlay indicator.
 * Called after transcription/transformation/delivery is complete.
 */
async function hideRecordingOverlay() {
	if (!window.__TAURI_INTERNALS__) return;
	try {
		await invoke('hide_recording_overlay');
	} catch (error) {
		console.error('Failed to hide recording overlay:', error);
	}
}

// Track manual recording start time for duration calculation
let manualRecordingStartTime: null | number = null;

// Track how the current recording was initiated
let recordingInitiatedVia: 'global-shortcut' | 'local' | null = null;

// 'ask' recordings send the transcript to the Ask overlay instead of delivering it
let recordingIntent: 'dictate' | 'ask' = 'dictate';

// Track whether window was focused when recording started
// Used to determine if we should keep window visible during delivery
let wasWindowFocusedAtRecordingStart: boolean = false;

// Track text selected (with surrounding context) in focused app when recording started
// Used to send selected text + context + spoken instruction to LLM for inline editing
let selectionContextAtRecordingStart: SelectionContext | null = null;

// Track VAD recording state for debouncing and initiation context
let vadInitiatedVia: 'global-shortcut' | 'local' | null = null;
let vadSessionActive = false;
let vadDebounceTimeout: ReturnType<typeof setTimeout> | null = null;

// Helper function to check authentication and show dialog if not authenticated
// This ensures users are authenticated before they can start recording
async function checkAuthAndShowDialog(): Promise<boolean> {
	if (auth.isAuthenticated) {
		return true;
	}

	// Show auth required dialog and bring window to front
	if (window.__TAURI_INTERNALS__) {
		try {
			const { getCurrentWindow } = await import('@tauri-apps/api/window');
			const currentWindow = getCurrentWindow();
			await currentWindow.show();
			await currentWindow.setAlwaysOnTop(true);
			await currentWindow.setFocus();

			setTimeout(() => {
				currentWindow.setAlwaysOnTop(false).catch(() => {});
			}, 2000);
		} catch (windowError) {
			console.warn('Failed to bring window to front:', windowError);
		}
	}

	authRequiredDialog.open();
	return false;
}

// Internal mutations for manual recording
const startManualRecording = defineMutation({
	mutationKey: ['commands', 'startManualRecording'] as const,
	resultMutationFn: async ({ initiatedVia = 'local' }: { initiatedVia?: 'global-shortcut' | 'local' } = {}) => {
		console.log('🎙️ [COMMAND] startManualRecording called with initiatedVia:', initiatedVia);

		// Kick off focus + selection capture immediately (at press time) but do NOT
		// block on them — the mic start below runs concurrently. They're awaited
		// after the recorder has started.
		const isDesktop = !!window.__TAURI_INTERNALS__;
		const isGlobalShortcut = initiatedVia === 'global-shortcut';

		const focusPromise: Promise<boolean> = isDesktop
			? (async () => {
					try {
						const { getCurrentWindow } = await import('@tauri-apps/api/window');
						return await getCurrentWindow().isFocused();
					} catch {
						return false;
					}
				})()
			: Promise.resolve(false);

		const selectionPromise: Promise<SelectionContext | null> = (() => {
			if (!isDesktop || !isGlobalShortcut) return Promise.resolve(null);
			if (onboardingStore.isOpen && onboardingStore.currentStep === 'inline-edit') {
				// DOM selection is read synchronously right now, at press time
				const el = document.activeElement as HTMLTextAreaElement | null;
				if (
					el &&
					(el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') &&
					el.selectionStart !== el.selectionEnd
				) {
					return Promise.resolve({
						selectedText: el.value.slice(el.selectionStart!, el.selectionEnd!),
						contextBefore: el.value.slice(0, el.selectionStart!),
						contextAfter: el.value.slice(el.selectionEnd!),
					});
				}
				return Promise.resolve(null);
			}
			return services.clipboard.getSelectionWithContext().catch(() => null);
		})();

		// Check authentication first (anonymous users have session from onboarding start)
		const isAuthenticated = await checkAuthAndShowDialog();
		if (!isAuthenticated) {
			return NoteFluxErr({
				title: 'Authentication Required',
				description: 'Please sign in to start recording',
			});
		}

		// Same gate as the Groq case in transcription.ts: only users who will
		// actually hit the cloud proxy (Pro, active trial, or an onboarding demo
		// step). A lapsed free user falls back to local transcription.
		if (
			(subscription.hasProAccess || isOnboardingDemoStep()) &&
			settings.value['transcription.selectedTranscriptionService'] === 'Groq'
		)
			services.transcriptions.groq.warmUp({
				accessToken: auth.state.session?.access_token,
				apiKey: settings.value['apiKeys.groq'] || undefined,
			});

		const toastId = nanoid();
		notify.loading.execute({
			title: 'Preparing to record...',
			description: 'Setting up your recording environment...',
			id: toastId,
		});
		const { data: deviceAcquisitionOutcome, error: startRecordingError } =
			await recorder.startRecording.execute({ toastId });

		if (startRecordingError) {
			notify.error.execute({ id: toastId, ...startRecordingError });
			return Err(startRecordingError);
		}

		switch (deviceAcquisitionOutcome.outcome) {
			case 'success': {
				notify.success.execute({
					title: 'NoteFlux is recording...',
					description: 'Speak now and stop recording when done',
					id: toastId,
				});
				break;
			}
			case 'fallback': {
				settings.updateKey(
					'recording.selectedDeviceId',
					deviceAcquisitionOutcome.fallbackDeviceId,
				);
				switch (deviceAcquisitionOutcome.reason) {
					case 'no-device-selected': {
						notify.info.execute({
							title: 'Switched to available microphone',
							description:
								'No microphone was selected, so we automatically connected to an available one. You can update your selection in settings.',
							action: {
								href: '/settings/recording',
								label: 'Open Settings',
								type: 'link',
							},
							id: toastId,
						});
						break;
					}
					case 'preferred-device-unavailable': {
						notify.info.execute({
							title: 'Switched to different microphone',
							description:
								"Your previously selected microphone wasn't found, so we automatically connected to an available one.",
							action: {
								href: '/settings/recording',
								label: 'Open Settings',
								type: 'link',
							},
							id: toastId,
						});
						break;
					}
				}
			}
		}
		// Track start time and initiation method for duration calculation and pasting behavior
		manualRecordingStartTime = Date.now();
		recordingInitiatedVia = initiatedVia;
		console.info('Recording started');
		sound.playSoundIfEnabled.execute('manual-start');

		// Mic is already live — settle the press-time captures (they've been running
		// concurrently with the recorder start above)
		wasWindowFocusedAtRecordingStart = await focusPromise;
		selectionContextAtRecordingStart = await selectionPromise;

		// Track recording started in PostHog
		analytics.trackRecordingStarted('manual');

		return Ok(undefined);
	},
});

const stopManualRecording = defineMutation({
	mutationKey: ['commands', 'stopManualRecording'] as const,
	resultMutationFn: async () => {
		const toastId = nanoid();
		notify.loading.execute({
			title: 'Stopping recording...',
			description: 'Finalizing your audio capture...',
			id: toastId,
		});
		const { data: blob, error: stopRecordingError } =
			await recorder.stopRecording.execute({ toastId });
		if (stopRecordingError) {
			notify.error.execute({ id: toastId, ...stopRecordingError });
			// Ensure overlay is hidden even if stopping fails
			await hideRecordingOverlay();
			return Err(stopRecordingError);
		}

		notify.success.execute({
			title: 'Recording stopped',
			description: 'Your recording has been saved',
			id: toastId,
		});
		console.info('Recording stopped');
		sound.playSoundIfEnabled.execute('manual-stop');

		// Log manual recording completion
		let duration: number | undefined;
		const initiatedVia = recordingInitiatedVia || 'local';
		const intent = recordingIntent;
		recordingIntent = 'dictate';
		const selectionContext = selectionContextAtRecordingStart;
		if (manualRecordingStartTime) {
			duration = Date.now() - manualRecordingStartTime;
			manualRecordingStartTime = null; // Reset for next recording
		}
		recordingInitiatedVia = null; // Reset for next recording
		selectionContextAtRecordingStart = null; // Reset for next recording

		rpc.analytics.logEvent.execute({
			blob_size: blob.size,
			duration,
			type: 'manual_recording_completed',
		});

		// Track recording completion in PostHog
		analytics.trackRecordingCompleted('manual');

		try {
			await processRecordingPipeline({
				blob,
				completionDescription: 'Recording saved and session closed successfully',
				completionTitle: 'Recording Complete!',
				toastId,
				initiatedVia,
				selectionContext,
				intent,
			});
		} catch (error) {
			// Ensure overlay is hidden even if pipeline fails unexpectedly
			console.error('Unexpected error in recording pipeline:', error);
			await hideRecordingOverlay();
			throw error;
		}

		return Ok(undefined);
	},
});

// Internal mutations for VAD recording
const startVadRecording = defineMutation({
	mutationKey: ['commands', 'startVadRecording'] as const,
	resultMutationFn: async ({ initiatedVia = 'local' }: { initiatedVia?: 'global-shortcut' | 'local' } = {}) => {
		// Check authentication first
		const isAuthenticated = await checkAuthAndShowDialog();
		if (!isAuthenticated) {
			return NoteFluxErr({
				title: 'Authentication Required',
				description: 'Please sign in to start recording',
			});
		}

		// Store the initiation context
		vadInitiatedVia = initiatedVia;
		vadSessionActive = true;

		// Track VAD recording started in PostHog
		analytics.trackRecordingStarted('vad');

		// Clear any existing debounce timeout
		if (vadDebounceTimeout) {
			clearTimeout(vadDebounceTimeout);
			vadDebounceTimeout = null;
		}

		const toastId = nanoid();
		console.info('Starting voice activated capture');
		notify.loading.execute({
			title: 'Starting voice activated capture',
			description: 'Your voice activated capture is starting...',
			id: toastId,
		});
		const { data: deviceAcquisitionOutcome, error: startActiveListeningError } =
			await vadRecorder.startActiveListening.execute({
				onSpeechEnd: async (blob) => {
					// Debouncing: ignore if session is not active or already processing
					if (!vadSessionActive) {
						console.log('VAD onSpeechEnd ignored: session not active');
						return;
					}
					
					// Set session as inactive to prevent multiple triggers
					vadSessionActive = false;
					
					// Set up debounce timeout to prevent rapid retriggering
					vadDebounceTimeout = setTimeout(() => {
						vadSessionActive = true;
						vadDebounceTimeout = null;
					}, 2000); // 2 second debounce
					
					const toastId = nanoid();
					notify.success.execute({
						title: 'Voice activated speech captured',
						description: 'Your voice activated speech has been captured.',
						id: toastId,
					});
					console.info('Voice activated speech captured');
					// sound.playSoundIfEnabled.execute('vad-capture'); // Commented out until VAD mode is re-enabled

					// Log VAD recording completion
					rpc.analytics.logEvent.execute({
						blob_size: blob.size,
						type: 'vad_recording_completed',
						// VAD doesn't track duration by default
					});

					// Track recording completion in PostHog
					analytics.trackRecordingCompleted('vad');

					await processRecordingPipeline({
						blob,
						completionDescription:
							'Voice activated capture complete! Ready for another take',
						completionTitle: 'Voice activated capture complete!',
						toastId,
						initiatedVia: vadInitiatedVia || 'local', // Use the stored initiation context
					});
				},
				onSpeechStart: () => {
					notify.success.execute({
						title: 'Speech started',
						description: 'Recording started. Speak clearly and loudly.',
					});
				},
			});
		if (startActiveListeningError) {
			notify.error.execute({ id: toastId, ...startActiveListeningError });
			return Err(startActiveListeningError);
		}

		// Handle device acquisition outcome
		switch (deviceAcquisitionOutcome.outcome) {
			case 'success': {
				notify.success.execute({
					title: 'Voice activated capture started',
					description: 'Your voice activated capture has been started.',
					id: toastId,
				});
				break;
			}
			case 'fallback': {
				settings.updateKey(
					'recording.selectedDeviceId',
					deviceAcquisitionOutcome.fallbackDeviceId,
				);
				switch (deviceAcquisitionOutcome.reason) {
					case 'no-device-selected': {
						notify.info.execute({
							title: 'VAD started with available microphone',
							description:
								'No microphone was selected for VAD, so we automatically connected to an available one. You can update your selection in settings.',
							action: {
								href: '/settings/recording',
								label: 'Open Settings',
								type: 'link',
							},
							id: toastId,
						});
						break;
					}
					case 'preferred-device-unavailable': {
						notify.info.execute({
							title: 'VAD switched to different microphone',
							description:
								"Your previously selected VAD microphone wasn't found, so we automatically connected to an available one.",
							action: {
								href: '/settings/recording',
								label: 'Open Settings',
								type: 'link',
							},
							id: toastId,
						});
						break;
					}
				}
			}
		}

		// sound.playSoundIfEnabled.execute('vad-start'); // Commented out until VAD mode is re-enabled
		return Ok(undefined);
	},
});

const stopVadRecording = defineMutation({
	mutationKey: ['commands', 'stopVadRecording'] as const,
	resultMutationFn: async () => {
		const toastId = nanoid();
		console.info('Stopping voice activated capture');
		notify.loading.execute({
			title: 'Stopping voice activated capture...',
			description: 'Finalizing your voice activated capture...',
			id: toastId,
		});
		const { error: stopVadError } =
			await vadRecorder.stopActiveListening.execute(undefined);
		
		// Clean up VAD state regardless of success/failure
		vadInitiatedVia = null;
		vadSessionActive = false;
		if (vadDebounceTimeout) {
			clearTimeout(vadDebounceTimeout);
			vadDebounceTimeout = null;
		}
		
		if (stopVadError) {
			notify.error.execute({ id: toastId, ...stopVadError });
			return Err(stopVadError);
		}
		notify.success.execute({
			title: 'Voice activated capture stopped',
			description: 'Your voice activated capture has been stopped.',
			id: toastId,
		});
		// sound.playSoundIfEnabled.execute('vad-stop'); // Commented out until VAD mode is re-enabled
		return Ok(undefined);
	},
});

// Local intent flag + in-flight start promise, not a query against actual
// recorder state — a quick tap in hold mode fires the release before
// startManualRecording's backend call resolves, so checking
// getCurrentRecordingId at that point still returns null and the release
// would start a second recording instead of stopping the first one. Same
// race pushToTalk already guards against (src/lib/commands.ts) via its own
// isRecordingOrStarting + pendingStartPromise pair.
let isAskRecordingOrStarting = false;
let pendingAskStartPromise: ReturnType<typeof startManualRecording.execute> | null =
	null;

const toggleAskRecording = defineMutation({
	mutationKey: ['commands', 'toggleAskRecording'] as const,
	resultMutationFn: async () => {
		if (isAskRecordingOrStarting) {
			isAskRecordingOrStarting = false;
			if (pendingAskStartPromise) {
				const { error: startError } = await pendingAskStartPromise;
				pendingAskStartPromise = null;
				if (startError) return Err(startError);
			}
			return await stopManualRecording.execute(undefined);
		}

		recordingIntent = 'ask';
		isAskRecordingOrStarting = true;
		pendingAskStartPromise = startManualRecording.execute({
			initiatedVia: 'global-shortcut',
		});
		const result = await pendingAskStartPromise;
		if (result.error) {
			recordingIntent = 'dictate';
			isAskRecordingOrStarting = false;
			pendingAskStartPromise = null;
		} else if (isAskRecordingOrStarting) {
			pendingAskStartPromise = null;
		}
		return result;
	},
});

export const commands = {
	// Start manual recording
	startManualRecording,

	// Cancel manual recording
	cancelManualRecording: defineMutation({
		mutationKey: ['commands', 'cancelManualRecording'] as const,
		resultMutationFn: async ({ initiatedVia = 'local' }: { initiatedVia?: 'global-shortcut' | 'local' } = {}) => {
			recordingIntent = 'dictate';
			const toastId = nanoid();
			notify.loading.execute({
				title: 'Canceling recording...',
				description: 'Cleaning up recording session...',
				id: toastId,
			});
			const { data: cancelRecordingResult, error: cancelRecordingError } =
				await recorder.cancelRecording.execute({ toastId });
			if (cancelRecordingError) {
				notify.error.execute({ id: toastId, ...cancelRecordingError });
				await hideRecordingOverlay();
				return Err(cancelRecordingError);
			}
			switch (cancelRecordingResult.status) {
				case 'cancelled': {
					// Session cleanup is now handled internally by the recorder service
					// Reset start time and initiation method if recording was cancelled
					manualRecordingStartTime = null;
					recordingInitiatedVia = null;
					selectionContextAtRecordingStart = null;
					notify.success.execute({
						title: 'All Done!',
						description: 'Recording cancelled successfully',
						id: toastId,
					});
					sound.playSoundIfEnabled.execute('manual-cancel');
					console.info('Recording cancelled');
					// Ensure overlay is hidden when cancelled
					await hideRecordingOverlay();
					break;
				}
				case 'no-recording': {
					notify.info.execute({
						title: 'No active recording',
						description: 'There is no recording in progress to cancel.',
						id: toastId,
					});
					// Ensure overlay is hidden if stuck
					await hideRecordingOverlay();
					break;
				}
			}
			return Ok(undefined);
		},
	}),
	startVadRecording,
	stopManualRecording,
	toggleAskRecording,

	stopVadRecording,

	// Toggle manual recording
	toggleManualRecording: defineMutation({
		mutationKey: ['commands', 'toggleManualRecording'] as const,
		resultMutationFn: async ({ initiatedVia = 'local' }: { initiatedVia?: 'global-shortcut' | 'local' } = {}) => {
			console.log('🔄 [COMMAND] toggleManualRecording called with initiatedVia:', initiatedVia);
			const { data: currentRecordingId, error: getRecordingIdError } =
				await recorder.getCurrentRecordingId.fetch();
			if (getRecordingIdError) {
				notify.error.execute(getRecordingIdError);
				return Err(getRecordingIdError);
			}
			if (currentRecordingId) {
				return await stopManualRecording.execute(undefined);
			}
			return await startManualRecording.execute({ initiatedVia });
		},
	}),

	// Toggle VAD recording
	toggleVadRecording: defineMutation({
		mutationKey: ['commands', 'toggleVadRecording'] as const,
		resultMutationFn: async ({ initiatedVia = 'local' }: { initiatedVia?: 'global-shortcut' | 'local' } = {}) => {
			const { data: vadState } = await vadRecorder.getVadState.fetch();
			if (vadState === 'LISTENING' || vadState === 'SPEECH_DETECTED') {
				return await stopVadRecording.execute(undefined);
			}
			return await startVadRecording.execute({ initiatedVia });
		},
	}),

	// Upload recordings (supports multiple files)
	uploadRecordings: defineMutation({
		mutationKey: ['recordings', 'uploadRecordings'] as const,
		resultMutationFn: async ({ files }: { files: File[] }) => {
			// Check authentication first
			const isAuthenticated = await checkAuthAndShowDialog();
			if (!isAuthenticated) {
				return NoteFluxErr({
					title: 'Authentication Required',
					description: 'Please sign in to upload files',
				});
			}

			// Partition files into valid and invalid in a single pass
			const { invalid: invalidFiles, valid: validFiles } = files.reduce<{
				invalid: File[];
				valid: File[];
			}>(
				(acc, file) => {
					const isValid =
						file.type.startsWith('audio/') || file.type.startsWith('video/');
					acc[isValid ? 'valid' : 'invalid'].push(file);
					return acc;
				},
				{ invalid: [], valid: [] },
			);

			if (validFiles.length === 0) {
				return NoteFluxErr({
					title: 'No valid files',
					description: 'No valid audio or video files found.',
				});
			}

			if (invalidFiles.length > 0) {
				notify.warning.execute({
					title: 'Some files were skipped',
					description: `${invalidFiles.length} file(s) were not audio or video files`,
				});
			}

			// Process all valid files in parallel
			await Promise.all(
				validFiles.map(async (file) => {
					const arrayBuffer = await file.arrayBuffer();
					const audioBlob = new Blob([arrayBuffer], { type: file.type });

					// Log file upload event
					rpc.analytics.logEvent.execute({
						blob_size: audioBlob.size,
						type: 'file_uploaded',
					});

					// Track file upload as manual recording
					analytics.trackRecordingStarted('manual');
					analytics.trackRecordingCompleted('manual');

					// Each file gets its own toast notification
					const toastId = nanoid();
					await processRecordingPipeline({
						blob: audioBlob,
						completionDescription: file.name,
						completionTitle: 'File uploaded successfully!',
						toastId,
						initiatedVia: 'local', // File uploads are always local
					});
				}),
			);

			return Ok({
				processedCount: validFiles.length,
				skippedCount: invalidFiles.length,
			});
		},
	}),
};

const ASK_MODEL = 'openai/gpt-oss-120b';

const ASK_SYSTEM_PROMPT =
	"You are Noteflux Ask, a quick answer assistant inside a voice-first note app shown in a small card. Answer the user's question directly. Be concise: a few sentences unless the question needs more. Do not start with a preamble. If you cannot answer reliably, say so briefly. Use simple markdown where it helps: bold for key terms, bullet or numbered lists for multiple items, inline code for code or commands. The card is small, so skip headings, images, and tables.";

/**
 * Answers a spoken question in the Ask overlay: opens the overlay in its
 * loading state, asks the model, then fills in the answer or the error.
 */
// Recent turns of the open Ask thread, folded into the next prompt as plain
// text (the completion service only takes a single system/user prompt, not a
// messages array). Cleared whenever a question opens a fresh panel instead of
// continuing one that was already on screen. Capped so the prompt doesn't
// grow unbounded across a long thread.
let askConversationHistory: Array<{ answer: string; question: string }> = [];
const ASK_HISTORY_TURN_LIMIT = 6;
// The clipboard screenshot attached to the current thread, if any. Captured
// once when a fresh thread starts; follow-up questions in the same thread
// keep using it rather than re-checking the clipboard each time.
let askThreadImage: string | null = null;

function buildAskUserPrompt(question: string): string {
	if (askConversationHistory.length === 0) return question;
	const transcript = askConversationHistory
		.map((turn) => `Q: ${turn.question}\nA: ${turn.answer}`)
		.join('\n\n');
	return `Earlier in this conversation:\n\n${transcript}

New question: ${question}`;
}

const ASK_IMAGE_MAX_EDGE = 1536;
const ASK_THUMBNAIL_MAX_EDGE = 240;

function resizeRgbaToDataUrl(
	rgba: Uint8Array,
	width: number,
	height: number,
	maxEdge: number,
	quality: number,
): string {
	const sourceCanvas = document.createElement('canvas');
	sourceCanvas.width = width;
	sourceCanvas.height = height;
	const sourceCtx = sourceCanvas.getContext('2d');
	if (!sourceCtx) throw new Error('Could not get 2d context');
	sourceCtx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);

	const scale = Math.min(1, maxEdge / Math.max(width, height));
	const targetWidth = Math.max(1, Math.round(width * scale));
	const targetHeight = Math.max(1, Math.round(height * scale));

	const targetCanvas = document.createElement('canvas');
	targetCanvas.width = targetWidth;
	targetCanvas.height = targetHeight;
	const targetCtx = targetCanvas.getContext('2d');
	if (!targetCtx) throw new Error('Could not get 2d context');
	targetCtx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);

	return targetCanvas.toDataURL('image/jpeg', quality);
}

/**
 * Reads an image off the clipboard, if there is one, and produces two JPEGs:
 * one downscaled for the model (Groq charges a flat per-image token cost
 * regardless of resolution, so sending more than this buys nothing and only
 * costs upload time) and one much smaller for the overlay's thumbnail chip.
 * Returns null for a missing or unreadable clipboard image — that's the
 * common case (no screenshot copied), not an error.
 */
async function captureClipboardImageForAsk(): Promise<{
	forModel: string;
	thumbnail: string;
} | null> {
	try {
		const clipboardImage = await readImage();
		const [rgba, size] = await Promise.all([clipboardImage.rgba(), clipboardImage.size()]);
		return {
			forModel: resizeRgbaToDataUrl(rgba, size.width, size.height, ASK_IMAGE_MAX_EDGE, 0.85),
			thumbnail: resizeRgbaToDataUrl(
				rgba,
				size.width,
				size.height,
				ASK_THUMBNAIL_MAX_EDGE,
				0.6,
			),
		};
	} catch (error) {
		// Expected when there's genuinely no image on the clipboard — but also
		// catches real failures (decode errors, oversized representations),
		// which look identical from the outside without this. Logged, not
		// surfaced to the user: a failed capture silently falls back to a
		// text-only question rather than blocking the answer.
		console.error('[Ask] Failed to read clipboard image:', error);
		return null;
	}
}

async function answerVoiceQuestion(question: string, toastId: string) {
	const trimmedQuestion = question.trim();
	if (!trimmedQuestion) {
		notify.warning.execute({
			title: 'No question heard',
			description: 'Try asking again.',
			id: toastId,
		});
		return;
	}

	// Gated separately from transcription itself — a free user's voice can
	// still get transcribed (local fallback), but the actual Q&A answer is
	// Pro-only. Denial goes through the same cross-app-visible overlay panel
	// used elsewhere (see show_ask_overlay_toast), not a toast — this fires
	// from a global shortcut, so the main window (where toasts render) is
	// often not even the frontmost one.
	if (!subscription.hasProAccess) {
		analytics.trackAskBlockedNotPro();
		invoke('show_ask_overlay_toast', {
			message: 'Ask is a Pro feature — upgrade to use voice Q&A.',
			isError: true,
		}).catch(() => {});
		return;
	}

	// Run concurrently: the clipboard read is local and cheap, but there's no
	// reason to wait for it before showing the overlay. If this turns out to
	// be a follow-up, the capture is simply discarded below.
	const [isFollowUp, capturedImage] = await Promise.all([
		invoke<boolean>('show_ask_overlay', { question: trimmedQuestion }),
		captureClipboardImageForAsk(),
	]);

	if (!isFollowUp) {
		askConversationHistory = [];
		askThreadImage = capturedImage?.forModel ?? null;
		if (capturedImage) {
			await invoke('set_ask_overlay_thumbnail', { thumbnail: capturedImage.thumbnail });
		}
	}

	analytics.trackAskQuestionAsked({ isFollowUp, hasImage: !!askThreadImage });

	const { data: completion, error: completionError } =
		await services.completions.groq.complete({
			apiKey: settings.value['apiKeys.groq'] || undefined,
			accessToken: auth.state.session?.access_token,
			model: ASK_MODEL,
			systemPrompt: ASK_SYSTEM_PROMPT,
			userPrompt: buildAskUserPrompt(trimmedQuestion),
			// Lets the model search the web when a question needs current
			// information. tool_choice stays "auto" server-side, so this doesn't
			// slow down the common case where the model already knows the answer.
			// Mutually exclusive with an attached image — see groq.ts.
			enableBrowserSearch: !askThreadImage,
			imageBase64: askThreadImage ?? undefined,
			feature: 'ask',
		});

	if (completionError) {
		analytics.trackAskError(completionError.message);
		await invoke('set_ask_overlay_result', {
			answer: null,
			error: completionError.message,
		});
		return;
	}

	analytics.trackAskAnswerReceived({ isFollowUp, hasImage: !!askThreadImage });
	if (featureTutorial.activeFeature === 'ask') featureTutorial.complete('ask');

	const answerText = completion.text.trim();
	askConversationHistory.push({ answer: answerText, question: trimmedQuestion });
	if (askConversationHistory.length > ASK_HISTORY_TURN_LIMIT) {
		askConversationHistory.shift();
	}

	await invoke('set_ask_overlay_result', {
		answer: answerText,
		error: null,
	});
}

/**
 * Processes a recording through the full pipeline: save → transcribe → transform
 *
 * This function handles the complete flow from recording creation through transcription:
 * 1. Creates recording metadata and saves to database
 * 2. Handles database save errors
 * 3. Shows completion toast
 * 4. Executes transcription flow
 * 5. Applies transformation if one is selected
 */
async function processRecordingPipeline({
	blob,
	completionDescription,
	completionTitle,
	toastId,
	initiatedVia = 'local',
	selectionContext = null,
	intent = 'dictate',
}: {
	blob: Blob;
	completionDescription: string;
	completionTitle: string;
	toastId: string;
	initiatedVia?: 'global-shortcut' | 'local';
	selectionContext?: SelectionContext | null;
	intent?: 'dictate' | 'ask';
}) {
	const now = new Date().toISOString();
	const newRecordingId = nanoid();

	const { data: createdRecording, error: createRecordingError } =
		await recordings.createRecording.execute({
			title: '',
			blob,
			createdAt: now,
			id: newRecordingId,
			subtitle: '',
			timestamp: now,
			transcribedText: '',
			transcriptionStatus: 'UNPROCESSED',
			updatedAt: now,
		});

	if (createRecordingError) {
		notify.error.execute({
			title:
				'Your recording was captured but could not be saved to the database.',
			description: createRecordingError.message,
			action: { error: createRecordingError, type: 'more-details' },
			id: toastId,
		});
		await hideRecordingOverlay();
		return;
	}

	notify.success.execute({
		title: completionTitle,
		description: completionDescription,
		id: toastId,
	});

	const transcribeToastId = nanoid();

	// PostHog transcription-started/completed tracking now lives inside
	// transcribeBlob() in transcription.ts, next to the equivalent Aptabase
	// events — it has direct access to the real resolved provider
	// (actualProvider), whereas this call site does not. The old calls here
	// were hardcoded to 'groq' regardless of what actually ran (wrong for
	// every free-tier/local-fallback transcription); removed rather than
	// fixed in place since the correct data already existed one layer down.

	notify.loading.execute({
		title: 'Transcribing...',
		description: 'Your recording is being transcribed...',
		id: transcribeToastId,
	});

	const { data: transcribedText, error: transcribeError } =
		await transcription.transcribeRecording.execute(createdRecording);

	if (transcribeError) {
		if (transcribeError.name === 'NoteFluxError') {
			notify.error.execute({ id: transcribeToastId, ...transcribeError });
			await hideRecordingOverlay();
			return;
		}
		notify.error.execute({
			title: 'Failed to transcribe recording',
			description: 'Your recording could not be transcribed.',
			action: { error: transcribeError, type: 'more-details' },
			id: transcribeToastId,
		});
		await hideRecordingOverlay();
		return;
	}

	sound.playSoundIfEnabled.execute('transcriptionComplete');

	if (intent === 'ask') {
		await hideRecordingOverlay();
		await answerVoiceQuestion(transcribedText, transcribeToastId);
		return;
	}

	// COMMENTED OUT: Raw text delivery when transformation is selected
	// This ensures only transformed text goes to clipboard/cursor when transformation is applied
	// await delivery.deliverTranscriptionResult.execute({
	// 	text: transcribedText,
	// 	toastId: transcribeToastId,
	// 	initiatedVia,
	// });

	// Determine if we need to chain to transformation
	const transformationId =
		settings.value['transformations.selectedTransformationId'];

	// If no transformation is selected, or the user has text selected (inline edit takes
	// priority over transformation — intent is "edit this text", not "transform my speech"),
	// deliver via transcription path which handles the selectionContext inline-edit flow.
	const hasSelectionContext = !!selectionContext?.selectedText?.trim();
	// Transformations (default and custom alike) require Pro or an active
	// trial — they run an LLM call on every single transcription, same cost
	// shape as cloud transcription. Falls back to raw delivery silently, no
	// dialog/toast, since this fires automatically on every transcription.
	// See docs/specs/20260916T160000-pro-trial-and-feature-gating.md.
	if (!transformationId || hasSelectionContext || !subscription.hasProAccess) {
		await delivery.deliverTranscriptionResult.execute({
			text: transcribedText,
			toastId: transcribeToastId,
			initiatedVia,
			wasWindowFocusedAtStart: wasWindowFocusedAtRecordingStart,
			selectionContext,
		});

		// Track text delivery
		analytics.trackTextDelivered('clipboard');

		await hideRecordingOverlay();
		return;
	}

	// When transformation is selected, the raw text delivery above is skipped
	// The final transformed text will be delivered via deliverTransformationResult
	const { data: transformation, error: getTransformationError } =
		await transformations.queries
			.getTransformationById(() => transformationId)
			.fetch();

	const transformationNoLongerExists = !transformation;

	if (getTransformationError) {
		notify.error.execute(
			fromTaggedError(getTransformationError, {
				title: 'Failed to get transformation',
				action: { error: getTransformationError, type: 'more-details' },
			}),
		);
		await hideRecordingOverlay();
		return;
	}

	if (transformationNoLongerExists) {
		settings.updateKey('transformations.selectedTransformationId', null);
		notify.warning.execute({
			title: 'No matching transformation found',
			description:
				'No matching transformation found. Please select a different transformation.',
			action: {
				href: '/transformations',
				label: 'Select a different transformation',
				type: 'link',
			},
		});
		await hideRecordingOverlay();
		return;
	}

	const transformToastId = nanoid();
	notify.loading.execute({
		title: 'Running transformation...',
		description:
			'Applying your selected transformation to the transcribed text...',
		id: transformToastId,
	});
	const { data: transformationRun, error: transformError } =
		await transformer.transformRecording.execute({
			recordingId: createdRecording.id,
			transformation,
		});
	if (transformError) {
		notify.error.execute({ id: transformToastId, ...transformError });
		await hideRecordingOverlay();
		return;
	}

	if (transformationRun.status === 'failed') {
		notify.error.execute({
			title: 'Transformation error',
			description: transformationRun.error,
			action: { error: transformationRun.error, type: 'more-details' },
			id: transformToastId,
		});
		await hideRecordingOverlay();
		return;
	}

	sound.playSoundIfEnabled.execute('transformationComplete');

	await delivery.deliverTransformationResult.execute({
		text: transformationRun.output,
		toastId: transformToastId,
		initiatedVia,
		wasWindowFocusedAtStart: wasWindowFocusedAtRecordingStart,
	});

	// Track text delivery for transformed text
	analytics.trackTextDelivered('clipboard');

	await hideRecordingOverlay();
}
