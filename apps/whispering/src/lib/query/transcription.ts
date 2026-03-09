import type { Recording } from '$lib/services/db';

import { NoteFluxErr, type NoteFluxError } from '$lib/result';
import * as services from '$lib/services';
import { settings } from '$lib/stores/settings.svelte';
import { applyDictionary } from '$lib/utils/dictionary';
import { getGroqApiKey } from '$lib/utils/embedded-keys';
import { Err, Ok, partitionResults, type Result } from 'wellcrafted/result';

import { rpc } from './';
import { defineMutation, queryClient } from './_client';
import { notify } from './notify';
import { recordings } from './recordings';

const transcriptionKeys = {
	isTranscribing: ['transcription', 'isTranscribing'] as const,
} as const;

// Track transcription count for periodic usage limit checks
let transcriptionCount = 0;
const CHECK_LIMIT_EVERY = 3; // Check usage limit every 3 transcriptions

// Helper function to show blocked dialog with window management
async function showBlockedDialog(totalMinutes: number, limitMinutes: number) {
	// More aggressive window management
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

	// Show usage limit dialog
	const { usageLimitDialog } = await import('$lib/stores/usage-limit-dialog.svelte');
	usageLimitDialog.open({
		totalMinutes,
		limitMinutes
	});
}

export const transcription = {
	isCurrentlyTranscribing() {
		return (
			queryClient.isMutating({
				mutationKey: transcriptionKeys.isTranscribing,
			}) > 0
		);
	},
	transcribeRecording: defineMutation({
		mutationKey: transcriptionKeys.isTranscribing,
		resultMutationFn: async (
			recording: Recording,
		): Promise<Result<string, NoteFluxError>> => {
			if (!recording.blob) {
				return NoteFluxErr({
					title: '⚠️ Recording blob not found',
					description: "Your recording doesn't have a blob to transcribe.",
				});
			}
			const { error: setRecordingTranscribingError } =
				await recordings.updateRecording.execute({
					...recording,
					transcriptionStatus: 'TRANSCRIBING',
				});
			if (setRecordingTranscribingError) {
				notify.warning.execute({
					title:
						'⚠️ Unable to set recording transcription status to transcribing',
					description: 'Continuing with the transcription process...',
					action: {
						error: setRecordingTranscribingError,
						type: 'more-details',
					},
				});
			}
			const { data: transcribedText, error: transcribeError } =
				await transcribeBlob(recording.blob);
			if (transcribeError) {
				const { error: setRecordingTranscribingError } =
					await recordings.updateRecording.execute({
						...recording,
						transcriptionStatus: 'FAILED',
					});
				if (setRecordingTranscribingError) {
					notify.warning.execute({
						title: '⚠️ Unable to update recording after transcription',
						description:
							"Transcription failed but unable to update recording's transcription status in database",
						action: {
							error: setRecordingTranscribingError,
							type: 'more-details',
						},
					});
				}
				return Err(transcribeError);
			}

			const { error: setRecordingTranscribedTextError } =
				await recordings.updateRecording.execute({
					...recording,
					transcribedText,
					transcriptionStatus: 'DONE',
				});
			if (setRecordingTranscribedTextError) {
				notify.warning.execute({
					title: '⚠️ Unable to update recording after transcription',
					description:
						"Transcription completed but unable to update recording's transcribed text and status in database",
					action: {
						error: setRecordingTranscribedTextError,
						type: 'more-details',
					},
				});
			}
			return Ok(transcribedText);
		},
	}),

	transcribeRecordings: defineMutation({
		mutationKey: transcriptionKeys.isTranscribing,
		resultMutationFn: async (recordings: Recording[]) => {
			const results = await Promise.all(
				recordings.map(async (recording) => {
					if (!recording.blob) {
						return NoteFluxErr({
							title: '⚠️ Recording blob not found',
							description: "Your recording doesn't have a blob to transcribe.",
						});
					}
					return await transcribeBlob(recording.blob);
				}),
			);
			const partitionedResults = partitionResults(results);
			return Ok(partitionedResults);
		},
	}),
};

async function transcribeBlob(
	blob: Blob,
): Promise<Result<string, NoteFluxError>> {
	// Increment transcription count
	transcriptionCount++;
	
	try {
		const { supabase } = await import('$lib/services/auth/supabase-client');
		const { data: { user } } = await supabase.auth.getUser();
		
		if (user) {
			// First, check if this user needs frequent checking (lightweight query)
			const { data: checkData } = await supabase
				.from('total_usage_limit')
				.select('needs_frequent_checks, is_blocked, total_minutes, limit_minutes')
				.eq('user_id', user.id)
				.single();
			
			// If user needs frequent checks, verify their blocked status on every transcription
			if (checkData?.needs_frequent_checks) {
				if (checkData.is_blocked) {
					// Still blocked, show dialog
					await showBlockedDialog(checkData.total_minutes, checkData.limit_minutes);
					
					return NoteFluxErr({
						title: '⚠️ Account blocked',
						description: 'Your account has been temporarily blocked. Contact support for assistance.',
					});
				} else {
					// Admin unblocked them - immediately reset frequent checks flag
					await supabase
						.from('total_usage_limit')
						.update({ needs_frequent_checks: false })
						.eq('user_id', user.id);
				}
			}
		} else {
			// User not authenticated - show dialog and block transcription
			// More aggressive window management
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

			// Show auth required dialog
			const { authRequiredDialog } = await import('$lib/stores/auth-required-dialog.svelte');
			authRequiredDialog.open();
			
			return NoteFluxErr({
				title: '🔐 Authentication Required',
				description: 'Please sign in to use transcription',
			});
		}
	} catch (error) {
		console.error('Auth check failed:', error);
		
		// If auth check fails due to error, block transcription for security
		// Show auth required dialog as we can't verify authentication
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

		const { authRequiredDialog } = await import('$lib/stores/auth-required-dialog.svelte');
		authRequiredDialog.open();
		
		return NoteFluxErr({
			title: '🔐 Authentication check failed',
			description: 'Unable to verify authentication. Please try again.',
		});
	}
	
	// Normal periodic check for usage limits (every 3rd transcription)  
	const shouldDoFullCheck = transcriptionCount % CHECK_LIMIT_EVERY === 0;
	
	if (shouldDoFullCheck) {
		try {
			// Import usage tracking dynamically to avoid circular imports
			const { checkUsageLimitAndBlockStatus } = await import('$lib/services/usage-tracking');
			const limitCheck = await checkUsageLimitAndBlockStatus();
			
			if (limitCheck && (limitCheck.isBlocked || limitCheck.isOverLimit)) {
				// Show blocked dialog BEFORE returning error
				await showBlockedDialog(limitCheck.totalMinutes, limitCheck.limitMinutes);
				
				// IMMEDIATELY return error - don't let this transcription complete
				return NoteFluxErr({
					title: '⚠️ Usage limit reached',
					description: `You've used ${limitCheck.totalMinutes.toFixed(0)} out of ${limitCheck.limitMinutes} minutes.`,
				});
			}
		} catch (error) {
			console.warn('Usage limit check failed, continuing with transcription:', error);
			// Don't block transcription if limit check fails
		}
	}

	const selectedService =
		settings.value['transcription.selectedTranscriptionService'];

	// Log transcription request
	const startTime = Date.now();
	rpc.analytics.logEvent.execute({
		provider: selectedService,
		type: 'transcription_requested',
	});

	const transcriptionResult: Result<string, NoteFluxError> =
		await (async () => {
			switch (selectedService) {
				// COMMENTED OUT: BYOK providers - using only Groq for SaaS model
				// case 'Deepgram':
				// 	return await services.transcriptions.deepgram.transcribe(blob, {
				// 		apiKey: settings.value['apiKeys.deepgram'],
				// 		modelName: settings.value['transcription.deepgram.model'],
				// 		outputLanguage: settings.value['transcription.outputLanguage'],
				// 		prompt: settings.value['transcription.prompt'],
				// 		temperature: settings.value['transcription.temperature'],
				// 	});
				// case 'ElevenLabs':
				// 	return await services.transcriptions.elevenlabs.transcribe(blob, {
				// 		apiKey: settings.value['apiKeys.elevenlabs'],
				// 		modelName: settings.value['transcription.elevenlabs.model'],
				// 		outputLanguage: settings.value['transcription.outputLanguage'],
				// 		prompt: settings.value['transcription.prompt'],
				// 		temperature: settings.value['transcription.temperature'],
				// 	});
				case 'Groq':
					return await services.transcriptions.groq.transcribe(blob, {
						apiKey: getGroqApiKey(),
						modelName: settings.value['transcription.groq.model'],
						outputLanguage: settings.value['transcription.outputLanguage'],
						prompt: settings.value['transcription.prompt'],
						temperature: settings.value['transcription.temperature'],
					});
				// case 'OpenAI':
				// 	return await services.transcriptions.openai.transcribe(blob, {
				// 		apiKey: settings.value['apiKeys.openai'],
				// 		modelName: settings.value['transcription.openai.model'],
				// 		outputLanguage: settings.value['transcription.outputLanguage'],
				// 		prompt: settings.value['transcription.prompt'],
				// 		temperature: settings.value['transcription.temperature'],
				// 	});
				// case 'speaches':
				// 	return await services.transcriptions.speaches.transcribe(blob, {
				// 		baseUrl: settings.value['transcription.speaches.baseUrl'],
				// 		modelId: settings.value['transcription.speaches.modelId'],
				// 		outputLanguage: settings.value['transcription.outputLanguage'],
				// 		prompt: settings.value['transcription.prompt'],
				// 		temperature: settings.value['transcription.temperature'],
				// 	});
				default:
					return NoteFluxErr({
						title: '⚠️ Unsupported transcription service',
						description: `The selected service "${selectedService}" is not supported in SaaS mode.`,
					});
			}
		})();

	// Log transcription result
	const duration = Date.now() - startTime;
	if (transcriptionResult.error) {
		rpc.analytics.logEvent.execute({
			error_description: transcriptionResult.error.description,
			error_title: transcriptionResult.error.title,
			provider: selectedService,
			type: 'transcription_failed',
		});
	} else {
		rpc.analytics.logEvent.execute({
			duration,
			provider: selectedService,
			type: 'transcription_completed',
		});

		// Track usage for billing/analytics (fire-and-forget, won't block)
		// Only track for services that charge by duration (like Groq)
		if (selectedService === 'Groq') {
			try {
				// Import usage tracking dynamically to avoid circular imports
				const { trackUsage, getAudioDurationFromBlob } = await import('$lib/services/usage-tracking');
				const durationMinutes = await getAudioDurationFromBlob(blob);
				trackUsage({
					durationMinutes,
					estimatedCost: 0, // Will be calculated in trackUsage
					provider: selectedService,
					fileName: 'audio-recording' // Could be enhanced to use actual filename
				});
			} catch (error) {
				console.warn('Usage tracking failed, but transcription succeeded:', error);
				// Don't fail the transcription if usage tracking fails
			}
		}
	}

	// Apply dictionary replacements before returning
	if (transcriptionResult.data) {
		const entries = settings.value['transcription.dictionary'];
		return Ok(applyDictionary(transcriptionResult.data, entries));
	}

	return transcriptionResult;
}
