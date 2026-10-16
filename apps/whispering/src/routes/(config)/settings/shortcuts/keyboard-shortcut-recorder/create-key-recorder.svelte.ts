import type { KeyboardEventSupportedKey } from '$lib/constants/keyboard';
import type { PressedKeys } from '$lib/utils/createPressedKeys.svelte';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

const CAPTURE_WINDOW_MS = 1000; // Time to wait for additional keys in a combination

// Keys that never complete a shortcut via the capture window alone.
// Modifiers need a letter. Fn completes via the Fn-release event (tap = Fn alone).
const MODIFIER_KEYS = new Set<KeyboardEventSupportedKey>([
	'alt',
	'altgraph',
	'control',
	'fn',
	'meta',
	'shift',
	'super',
]);

export type KeyRecorder = ReturnType<typeof createKeyRecorder>;

/**
 * Creates a keyboard shortcut recorder that captures key combinations
 *
 * How it works:
 * 1. When recording starts, any pressed keys are captured
 * 2. Each new key extends a 300ms capture window
 * 3. The combination completes when:
 *    - All keys are released (immediate), OR
 *    - The capture window expires (300ms after last key)
 * 4. Escape key cancels recording at any time
 *
 * This approach handles all common patterns:
 * - Quick taps (Ctrl+C)
 * - Held modifiers (Cmd+Shift+P)
 * - Single keys (F5)
 * - Complex combinations built over time
 */
export function createKeyRecorder({
	onClear,
	onRegister,
	pressedKeys,
}: {
	onClear: () => void;
	onRegister: (keyCombination: KeyboardEventSupportedKey[]) => void;
	pressedKeys: PressedKeys;
}) {
	// State
	let isListening = $state(false);
	let capturedKeys = $state<KeyboardEventSupportedKey[]>([]);
	let captureWindowTimer: NodeJS.Timeout | null = null;
	let fnEventUnlisten: UnlistenFn | null = null;
	let fnReleaseUnlisten: UnlistenFn | null = null;

	// Helper: Detach Fn event listeners
	function unlistenFnEvents() {
		if (fnEventUnlisten) {
			fnEventUnlisten();
			fnEventUnlisten = null;
		}
		if (fnReleaseUnlisten) {
			fnReleaseUnlisten();
			fnReleaseUnlisten = null;
		}
	}

	// Helper: Clear the capture window timer
	function clearCaptureTimer() {
		if (captureWindowTimer) {
			clearTimeout(captureWindowTimer);
			captureWindowTimer = null;
		}
	}

	// Helper: Stop Fn recording mode and detach its event listener
	async function teardownRecording() {
		// Disable Fn recording mode
		if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
			try {
				await invoke('disable_fn_recording_mode');
			} catch (error) {
				console.error('[KeyRecorder] Failed to disable Fn recording mode:', error);
			}
		}

		// Unlisten from Fn events
		unlistenFnEvents();
	}

	// Helper: Whether a real (non-modifier) key has been captured
	function hasNonModifierKey() {
		for (const key of capturedKeys) {
			if (!MODIFIER_KEYS.has(key)) return true;
		}
		return false;
	}

	// Helper: Complete the key combination
	async function completeRecording(force = false) {
		if (!isListening || capturedKeys.length === 0) return;
		if (!force && !hasNonModifierKey()) return; // never register a modifier-only combo

		clearCaptureTimer();
		isListening = false;
		await teardownRecording();

		const combination = [...capturedKeys];
		capturedKeys = [];

		onRegister(combination);
	}

	// Helper: Abort recording without registering (e.g. a modifier tapped alone)
	async function cancelRecording() {
		if (!isListening) return;
		clearCaptureTimer();
		isListening = false;
		capturedKeys = [];
		await teardownRecording();
	}

	// Helper: Fires when the capture window expires with no further input
	function onCaptureWindowExpired() {
		if (!isListening) return;
		if (hasNonModifierKey()) {
			void completeRecording();
		} else {
			// Only modifiers captured so far: keep waiting for a real key to join
			clearCaptureTimer();
			captureWindowTimer = setTimeout(onCaptureWindowExpired, CAPTURE_WINDOW_MS);
		}
	}

	// Main effect: Watch for key changes
	$effect(() => {
		if (!isListening) return;

		// Escape key cancels recording
		if (pressedKeys.current.includes('escape')) {
			void cancelRecording();
			return;
		}

		// Track new keys
		let hasNewKeys = false;
		for (const key of pressedKeys.current) {
			if (!capturedKeys.includes(key)) {
				capturedKeys.push(key);
				hasNewKeys = true;
			}
		}

		// New keys extend the capture window
		if (hasNewKeys && capturedKeys.length > 0) {
			clearCaptureTimer();
			captureWindowTimer = setTimeout(onCaptureWindowExpired, CAPTURE_WINDOW_MS);
		}
	});

	// Public API
	return {
		async clear() {
			isListening = false;
			capturedKeys = [];
			clearCaptureTimer();

			// Disable Fn recording mode
			if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
				try {
					await invoke('disable_fn_recording_mode');
				} catch (error) {
					console.error('[KeyRecorder] Failed to disable Fn recording mode:', error);
				}
			}

			// Unlisten from Fn events
			unlistenFnEvents();

			onClear();
		},
		get isListening() {
			return isListening;
		},
		get captured() {
			return capturedKeys;
		},
		register: onRegister,
		async start() {
			isListening = true;
			capturedKeys = [];
			clearCaptureTimer();

			// Enable Fn recording mode in Tauri
			if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
				try {
					await invoke('enable_fn_recording_mode');

					// Listen for Fn key presses from Rust
					fnEventUnlisten = await listen('fn-key-pressed-for-recording', () => {
						if (!capturedKeys.includes('fn')) {
							capturedKeys.push('fn' as KeyboardEventSupportedKey);
						}

						// Extend capture window
						clearCaptureTimer();
						captureWindowTimer = setTimeout(onCaptureWindowExpired, CAPTURE_WINDOW_MS);
					});

					// Listen for Fn key release: a tap (no other key) means "Fn alone"
					fnReleaseUnlisten = await listen('fn-key-released-for-recording', () => {
						if (capturedKeys.length === 1 && capturedKeys.includes('fn')) {
							void completeRecording(true);
						}
					});
				} catch (error) {
					console.error('[KeyRecorder] Failed to enable Fn recording mode:', error);
				}
			}
		},
		async stop() {
			isListening = false;
			capturedKeys = [];
			clearCaptureTimer();

			// Disable Fn recording mode
			if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
				try {
					await invoke('disable_fn_recording_mode');
				} catch (error) {
					console.error('[KeyRecorder] Failed to disable Fn recording mode:', error);
				}
			}

			// Unlisten from Fn events
			unlistenFnEvents();
		},
	};
}
