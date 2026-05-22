import type { NoteFluxError } from '$lib/result';
import type { ClipboardServiceError } from '$lib/services/clipboard';
import type { SelectionContext } from '$lib/services/clipboard/types';

import { WHISPERING_RECORDINGS_PATHNAME } from '$lib/constants/app';
import * as services from '$lib/services';
import { settings } from '$lib/stores/settings.svelte';
import { onboardingStore } from '$lib/stores/onboarding.svelte';
import { Ok } from 'wellcrafted/result';
import { getGroqApiKey } from '$lib/utils/embedded-keys';
import { trackLlmUsage } from '$lib/services/usage-tracking';

import { defineMutation } from './_client';
import { rpc } from './index';

export const delivery = {
	/**
	 * Delivers transcribed text to the user according to their clipboard preferences.
	 *
	 * This mutation handles the complete delivery workflow for transcription results:
	 * 1. Shows a success toast with the transcribed text
	 * 2. Optionally copies text to clipboard based on user settings
	 * 3. Optionally pastes text at cursor based on user settings
	 * 4. Provides fallback UI actions when automatic operations fail
	 *
	 * The user's preferences are read from:
	 * - `transcription.clipboard.copyOnSuccess` - Whether to auto-copy
	 * - `transcription.clipboard.pasteOnSuccess` - Whether to auto-paste
	 *
	 * @param text - The transcribed text to deliver
	 * @param toastId - Unique ID for toast notifications to prevent duplicates
	 * @returns Result with no meaningful data (fire-and-forget operation)
	 *
	 * @example
	 * ```typescript
	 * // After transcription completes
	 * await rpc.delivery.deliverTranscriptionResult.execute({
	 *   text: transcribedText,
	 *   toastId: nanoid()
	 * });
	 * ```
	 */
	deliverTranscriptionResult: defineMutation({
		mutationKey: ['delivery', 'deliverTranscriptionResult'],
		resultMutationFn: async ({
			text,
			toastId,
			initiatedVia = 'local',
			wasWindowFocusedAtStart = false,
			selectionContext = null,
		}: {
			text: string;
			toastId: string;
			initiatedVia?: 'global-shortcut' | 'local';
			wasWindowFocusedAtStart?: boolean;
			selectionContext?: SelectionContext | null;
		}) => {
			// finalText starts as raw transcription; may be replaced by LLM-edited result.
			// Declared here so all notification closures below close over this binding and
			// automatically reflect the edited text when called after the LLM block.
			let finalText = text;

			// Normalize: whitespace-only selection = no selection
			const normalizedSelectedText = selectionContext?.selectedText?.trim() ?? null;
			const hasSelection = !!normalizedSelectedText;

			// Shows transcription result and offers manual copy action
			const offerManualCopy = () =>
				rpc.notify.success.execute({
					title: hasSelection ? '✏️ Inline edit result' : ' Recording transcribed!',
					description: finalText,
					action: {
						label: 'Copy to clipboard',
						onClick: async () => {
							const { error } = await rpc.clipboard.copyToClipboard.execute({
								text: finalText,
							});
							if (error) {
								// Report that manual copy attempt failed
								rpc.notify.error.execute({
									title: 'Error copying transcribed text to clipboard',
									description: error.message,
									action: { error, type: 'more-details' },
								});
								return;
							}
							// Confirm manual copy succeeded
							rpc.notify.success.execute({
								title: 'Copied transcribed text to clipboard!',
								description: finalText,
								id: toastId,
							});
						},
						type: 'button',
					},
					id: toastId,
				});

			// Warns that automatic copy failed and falls back to manual option
			const warnAutoCopyFailed = (error: ClipboardServiceError) => {
				rpc.notify.warning.execute({
					title: "Couldn't copy to clipboard",
					description: error.message,
					action: { error, type: 'more-details' },
				});
			};

			// Confirms text is in clipboard (when paste is not attempted)
			const confirmTextInClipboard = () =>
				rpc.notify.success.execute({
					title: 'Recording transcribed and copied to clipboard!',
					description: finalText,
					action: {
						href: WHISPERING_RECORDINGS_PATHNAME,
						label: 'Go to recordings',
						type: 'link',
					},
					id: toastId,
				});

			// Warns that paste failed but confirms copy succeeded
			const warnPasteFailedButCopied = (
				error: ClipboardServiceError | NoteFluxError,
			) => {
				if (error.name === 'ClipboardServiceError') {
					rpc.notify.warning.execute({
						title: 'Unable to paste automatically',
						description: error.message,
						action: { error, type: 'more-details' },
					});
					return;
				}
				if (error.name === 'NoteFluxError') {
					rpc.notify[error.severity].execute(error);
					return;
				}
			};

			// Confirms complete delivery (both copy and paste succeeded)
			const confirmFullDelivery = (deliveredText: string) =>
				rpc.notify.success.execute({
					title: hasSelection
						? '✏️ Selected text replaced!'
						: ' Recording transcribed, copied to clipboard, and pasted!',
					description: deliveredText,
					action: {
						href: WHISPERING_RECORDINGS_PATHNAME,
						label: 'Go to recordings',
						type: 'link',
					},
					id: toastId,
				});

			if (hasSelection && selectionContext) {
				// Guard: instruction too short to be meaningful
				if (text.trim().length < 3) {
					rpc.notify.error.execute({
						title: '⚠️ Instruction too short',
						description: 'Speak a clear instruction to edit the selected text.',
						id: toastId,
					});
					return Ok(undefined);
				}

				// Guard: selection too long for context window
				if (normalizedSelectedText.length > 4000) {
					rpc.notify.error.execute({
						title: '⚠️ Selection too long',
						description: 'Select less than 4000 characters for smart editing.',
						id: toastId,
					});
					return Ok(undefined);
				}

				// Guard: no API key
				const apiKey = getGroqApiKey();
				if (!apiKey) {
					rpc.notify.error.execute({
						title: '⚠️ No Groq API key',
						description: 'Add a Groq API key in Settings to use smart editing.',
						id: toastId,
					});
					return Ok(undefined);
				}

				rpc.notify.loading.execute({
					title: '✏️ Editing selected text...',
					description: 'Applying your instruction...',
					id: toastId,
				});

				// Build prompt — include surrounding context when available so the model
				// can match punctuation, capitalisation, and style of adjacent text
				const contextBefore = selectionContext.contextBefore;
				const contextAfter = selectionContext.contextAfter;
				const hasContext = contextBefore.length > 0 || contextAfter.length > 0;
				const userPrompt = hasContext
					? `<context_before>${contextBefore}</context_before>\n\n<selected_text>${normalizedSelectedText}</selected_text>\n\n<context_after>${contextAfter}</context_after>\n\n<instruction>${text}</instruction>`
					: `<selected_text>${normalizedSelectedText}</selected_text>\n\n<instruction>${text}</instruction>`;

				const { data: rawEditedText, error: editError } =
					await services.completions.groq.complete({
						apiKey,
						model: 'llama-3.3-70b-versatile',
						systemPrompt:
							'You are a text replacement engine. Your output is ONLY the replacement text — nothing else.\n\nStrict rules:\n- No preamble. No "Here is...", "Sure!", "The edited text:", or any opener.\n- No surrounding quotes.\n- No code fences unless the input itself is code.\n- Use context_before and context_after (if provided) to match surrounding punctuation, capitalisation, and style — but only output the replacement for selected_text.\n- Preserve original formatting, whitespace, and line breaks unless the instruction requires changing them.\n- Preserve original language unless the instruction is to translate.\n- If the text needs no change, return the original text exactly.',
						userPrompt,
					});

				if (editError) {
					rpc.notify.error.execute({
						title: '⚠️ Inline edit failed',
						description: editError.message,
						id: toastId,
					});
					return Ok(undefined);
				}

				// Fire-and-forget usage tracking
				trackLlmUsage({
					feature: 'inline-edit',
					provider: 'groq',
					model: 'llama-3.3-70b-versatile',
					inputTokens: rawEditedText.inputTokens,
					outputTokens: rawEditedText.outputTokens,
				});

				finalText = rawEditedText.text.trim();
			}

			// Main delivery flow

			// If user doesn't want auto-copy, just show the result with manual option
			if (!settings.value['transcription.clipboard.copyOnSuccess']) {
				offerManualCopy();
				return Ok(undefined);
			}

			// Try to copy to clipboard
			const { error: copyError } = await rpc.clipboard.copyToClipboard.execute({
				text: finalText,
			});
			if (copyError) {
				warnAutoCopyFailed(copyError);
				offerManualCopy();
				return Ok(undefined);
			}

			// If user doesn't want auto-paste, confirm copy only
			if (!settings.value['transcription.clipboard.pasteOnSuccess']) {
				confirmTextInClipboard();
				return Ok(undefined);
			}

			// Try to paste at cursor - use different methods based on how recording was initiated

			// No delay needed since we use notifications instead of overlays

			let pasteError: ClipboardServiceError | NoteFluxError | null | undefined;
			if (initiatedVia === 'global-shortcut') {
				// For global shortcuts, type directly at cursor position to ensure it works
				// regardless of focus changes during recording

				// Check if we're pasting into the app itself (e.g., during onboarding)
				// If so, keep the window visible instead of hiding it
				const activeElement = document.activeElement;
				const isPastingIntoApp = activeElement &&
					(activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT');

				// Check if we're actively in the onboarding flow (dialog open at usage-guide)
				const isInOnboarding = onboardingStore.isOpen && onboardingStore.currentStep === 'usage-guide';

				// Check if we're on the settings page (testing shortcut)
				const isOnSettingsPage = window.location.pathname.includes('/settings/shortcuts');

				// During onboarding, always refocus to ensure text goes to the right place
				// After onboarding, only refocus on first paste test
				const pasteTestCompleted = settings.value['onboarding.pasteTestCompleted'];
				const shouldRefocus = isPastingIntoApp && (isInOnboarding || !pasteTestCompleted);

				// Keep window visible if:
				// 1. Window was focused when recording started (user initiated from within app)
				// 2. Pasting into app (textarea/input has focus)
				// 3. On settings page (testing shortcuts)
				const shouldKeepVisible = wasWindowFocusedAtStart || isPastingIntoApp || isOnSettingsPage;

				const { error } = await rpc.clipboard.typeAtCursor.execute({
					text: finalText,
					keepWindowVisible: shouldKeepVisible || undefined,
					refocusWindow: shouldRefocus || undefined,
				});
				pasteError = error;
				if (pasteError) {
					console.error('[DELIVERY] typeAtCursor failed:', pasteError);
				} else {
					// Mark paste test as completed after first successful paste during onboarding
					if (shouldRefocus) {
						settings.updateKey('onboarding.pasteTestCompleted', true);
					}
				}
			} else {
				// For local shortcuts, use standard paste (Cmd+V/Ctrl+V)
				const { error } = await rpc.clipboard.pasteFromClipboard.execute(undefined);
				pasteError = error;
				if (pasteError) {
					console.error('[DELIVERY] pasteFromClipboard failed:', pasteError);
				}
			}

			if (pasteError) {
				warnPasteFailedButCopied(pasteError);
				confirmTextInClipboard();
				return Ok(undefined);
			}

			// Everything succeeded
			confirmFullDelivery(finalText);
			return Ok(undefined);
		},
	}),

	/**
	 * Delivers transformed text to the user according to their clipboard preferences.
	 *
	 * This mutation handles the complete delivery workflow for transformation results:
	 * 1. Shows a success toast with the transformed text
	 * 2. Optionally copies text to clipboard based on user settings
	 * 3. Optionally pastes text at cursor based on user settings
	 * 4. Provides fallback UI actions when automatic operations fail
	 *
	 * The user's preferences are read from:
	 * - `transformation.clipboard.copyOnSuccess` - Whether to auto-copy
	 * - `transformation.clipboard.pasteOnSuccess` - Whether to auto-paste
	 *
	 * @param text - The transformed text to deliver
	 * @param toastId - Unique ID for toast notifications to prevent duplicates
	 * @returns Result with no meaningful data (fire-and-forget operation)
	 *
	 * @example
	 * ```typescript
	 * // After transformation completes
	 * await rpc.delivery.deliverTransformationResult.execute({
	 *   text: transformedText,
	 *   toastId: nanoid()
	 * });
	 * ```
	 */
	deliverTransformationResult: defineMutation({
		mutationKey: ['delivery', 'deliverTransformationResult'],
		resultMutationFn: async ({
			text,
			toastId,
			initiatedVia = 'local',
			wasWindowFocusedAtStart = false,
		}: {
			text: string;
			toastId: string;
			initiatedVia?: 'global-shortcut' | 'local';
			wasWindowFocusedAtStart?: boolean;
		}) => {
			// Define all notification functions at the top for clarity

			// Shows transformation result and offers manual copy action
			const offerManualCopy = () =>
				rpc.notify.success.execute({
					title: 'Transformation complete!',
					description: text,
					action: {
						label: 'Copy to clipboard',
						onClick: async () => {
							const { error } = await rpc.clipboard.copyToClipboard.execute({
								text,
							});
							if (error) {
								// Report that manual copy attempt failed
								rpc.notify.error.execute({
									title: 'Error copying transformed text to clipboard',
									description: error.message,
									action: { error, type: 'more-details' },
								});
								return;
							}
							// Confirm manual copy succeeded
							rpc.notify.success.execute({
								title: 'Copied transformed text to clipboard!',
								description: text,
								id: toastId,
							});
						},
						type: 'button',
					},
					id: toastId,
				});

			// Warns that automatic copy failed and falls back to manual option
			const warnAutoCopyFailed = (error: ClipboardServiceError) => {
				rpc.notify.warning.execute({
					title: "Couldn't copy to clipboard",
					description: error.message,
					action: { error, type: 'more-details' },
				});
			};

			// Confirms text is in clipboard (when paste is not attempted)
			const confirmTextInClipboard = () =>
				rpc.notify.success.execute({
					title: 'Transformation complete and copied to clipboard!',
					description: text,
					action: {
						href: WHISPERING_RECORDINGS_PATHNAME,
						label: 'Go to recordings',
						type: 'link',
					},
					id: toastId,
				});

			// Warns that paste failed but confirms copy succeeded
			const warnPasteFailedButCopied = (
				error: ClipboardServiceError | NoteFluxError,
			) => {
				if (error.name === 'ClipboardServiceError') {
					rpc.notify.error.execute({
						title: 'Error pasting transformed text to cursor',
						description: error.message,
						action: { error, type: 'more-details' },
					});
					return;
				}
				if (error.name === 'NoteFluxError') {
					rpc.notify[error.severity].execute(error);
					return;
				}
			};

			// Confirms complete delivery (both copy and paste succeeded)
			const confirmFullDelivery = () =>
				rpc.notify.success.execute({
					title: ' Transformation complete, copied to clipboard, and pasted!',
					description: text,
					action: {
						href: WHISPERING_RECORDINGS_PATHNAME,
						label: 'Go to recordings',
						type: 'link',
					},
					id: toastId,
				});

			// Main delivery flow

			// If user doesn't want auto-copy, just show the result with manual option
			if (!settings.value['transformation.clipboard.copyOnSuccess']) {
				offerManualCopy();
				return Ok(undefined);
			}

			// Try to copy to clipboard
			const { error: copyError } = await rpc.clipboard.copyToClipboard.execute({
				text,
			});
			if (copyError) {
				warnAutoCopyFailed(copyError);
				offerManualCopy();
				return Ok(undefined);
			}

			// If user doesn't want auto-paste, confirm copy only
			if (!settings.value['transformation.clipboard.pasteOnSuccess']) {
				confirmTextInClipboard();
				return Ok(undefined);
			}

			// Try to paste at cursor - use different methods based on how recording was initiated

			// No delay needed since we use notifications instead of overlays

			let pasteError: ClipboardServiceError | NoteFluxError | null | undefined;
			if (initiatedVia === 'global-shortcut') {
				// For global shortcuts, type directly at cursor position to ensure it works
				// regardless of focus changes during recording

				// Check if we're pasting into the app itself (e.g., during onboarding)
				// If so, keep the window visible instead of hiding it
				const activeElement = document.activeElement;
				const isPastingIntoApp = activeElement &&
					(activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT');

				// Check if we're actively in the onboarding flow (dialog open at usage-guide)
				const isInOnboarding = onboardingStore.isOpen && onboardingStore.currentStep === 'usage-guide';

				// Check if we're on the settings page (testing shortcut)
				const isOnSettingsPage = window.location.pathname.includes('/settings/shortcuts');

				// During onboarding, always refocus to ensure text goes to the right place
				// After onboarding, only refocus on first paste test
				const pasteTestCompleted = settings.value['onboarding.pasteTestCompleted'];
				const shouldRefocus = isPastingIntoApp && (isInOnboarding || !pasteTestCompleted);

				// Keep window visible if:
				// 1. Window was focused when recording started (user initiated from within app)
				// 2. Pasting into app (textarea/input has focus)
				// 3. On settings page (testing shortcuts)
				const shouldKeepVisible = wasWindowFocusedAtStart || isPastingIntoApp || isOnSettingsPage;


			const { error } = await rpc.clipboard.typeAtCursor.execute({
				text,
			keepWindowVisible: shouldKeepVisible || undefined,
				refocusWindow: shouldRefocus || undefined,
			});
			pasteError = error;
			if (pasteError) {
				console.error('[DELIVERY] typeAtCursor failed:', pasteError);
			} else {
				// Mark paste test as completed after first successful paste during onboarding
				if (shouldRefocus) {
					settings.updateKey('onboarding.pasteTestCompleted', true);
				}
			}
		} else {
				// For local shortcuts, use standard paste (Cmd+V/Ctrl+V)
				const { error } = await rpc.clipboard.pasteFromClipboard.execute(undefined);
				pasteError = error;
				if (pasteError) {
					console.error('[DELIVERY] pasteFromClipboard failed:', pasteError);
				} else {
				}
			}

			if (pasteError) {
				warnPasteFailedButCopied(pasteError);
				confirmTextInClipboard();
				return Ok(undefined);
			}

			// Everything succeeded
			confirmFullDelivery();
			return Ok(undefined);
		},
	}),
};
