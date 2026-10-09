import type { Accelerator } from '$lib/services/global-shortcut-manager';
import type { Settings } from '$lib/settings';

import { type Command, commands } from '$lib/commands';
import { rpc } from '$lib/query';
// Commented out - using global shortcuts only
// import {
// 	type CommandId,
// 	shortcutStringToArray,
// } from '$lib/services/local-shortcut-manager';
import { settings } from '$lib/stores/settings.svelte';
import { partitionResults } from 'wellcrafted/result';

/**
 * Checks if any global shortcuts are duplicated and resets all to defaults if duplicates found.
 * Returns true if duplicates were found and reset, false otherwise.
 */
export function resetGlobalShortcutsToDefaultIfDuplicates(): boolean {
	const globalShortcuts = new Map<string, string>();

	// Check for duplicates
	for (const command of commands) {
		const shortcut = settings.value[`shortcuts.global.${command.id}`];
		if (shortcut) {
			if (globalShortcuts.has(shortcut)) {
				// If duplicates found, reset all global shortcuts to defaults
				settings.resetShortcuts('global');
				rpc.notify.success.execute({
					title: 'Shortcuts reset',
					description:
						'Duplicate global shortcuts detected. All global shortcuts have been reset to defaults.',
					action: {
						href: '/settings/shortcuts/global',
						label: 'Configure shortcuts',
						type: 'link',
					},
				});

				return true;
			}
			globalShortcuts.set(shortcut, command.id);
		}
	}
	return false;
}

/**
 * Checks if any local shortcuts are duplicated and resets all to defaults if duplicates found.
 * Returns true if duplicates were found and reset, false otherwise.
 * COMMENTED OUT - Using global shortcuts only
 */
// export function resetLocalShortcutsToDefaultIfDuplicates(): boolean {
// 	const localShortcuts = new Map<string, string>();

// 	// Check for duplicates
// 	for (const command of commands) {
// 		const shortcut = settings.value[`shortcuts.local.${command.id}`];
// 		if (shortcut) {
// 			if (localShortcuts.has(shortcut)) {
// 				// If duplicates found, reset all local shortcuts to defaults
// 				settings.resetShortcuts('local');
// 				rpc.notify.success.execute({
// 					title: 'Shortcuts reset',
// 					description:
// 						'Duplicate local shortcuts detected. All local shortcuts have been reset to defaults.',
// 					action: {
// 						href: '/settings/shortcuts/local',
// 						label: 'Configure shortcuts',
// 						type: 'link',
// 					},
// 				});

// 				return true;
// 			}
// 			localShortcuts.set(shortcut, command.id);
// 		}
// 	}
// 	return false;
// }

/**
 * Synchronizes global keyboard shortcuts with the current settings.
 * - Checks accessibility permissions on macOS before registering shortcuts
 * - Registers shortcuts that have key combinations defined in settings
 * - Unregisters shortcuts that don't have key combinations defined
 * - Shows error toast if any registration/unregistration fails
 */
export async function syncGlobalShortcutsWithSettings() {
	const recordingMode = settings.value['shortcuts.recordingMode'];

	// First, unregister inactive mode's shortcut to prevent conflicts
	if (recordingMode === 'hold') {
		// In hold mode, unregister toggleManualRecording if it has a shortcut
		const toggleShortcut = settings.value['shortcuts.global.toggleManualRecording'];
		if (toggleShortcut) {
			await rpc.shortcuts.unregisterCommandGlobally.execute({
				accelerator: toggleShortcut as Accelerator,
			});
		}
	} else {
		// In toggle mode, unregister pushToTalk if it has a shortcut
		const pushToTalkShortcut = settings.value['shortcuts.global.pushToTalk'];
		if (pushToTalkShortcut) {
			await rpc.shortcuts.unregisterCommandGlobally.execute({
				accelerator: pushToTalkShortcut as Accelerator,
			});
		}
	}

	const results = await Promise.all(
		commands
			.map((command) => {
				// Skip pushToTalk if in toggle mode
				if (command.id === 'pushToTalk' && recordingMode === 'toggle') {
					return;
				}

				// Skip toggleManualRecording if in hold mode
				if (command.id === 'toggleManualRecording' && recordingMode === 'hold') {
					return;
				}

				let accelerator = settings.value[
					`shortcuts.global.${command.id}`
				] as Accelerator | null;

				// Force update cancelManualRecording to new default if it's null
				if (command.id === 'cancelManualRecording' && !accelerator) {
					accelerator = 'Command+Escape' as Accelerator;
					settings.updateKey('shortcuts.global.cancelManualRecording', accelerator);
				}

				if (!accelerator) return;

				// Ask follows Recording Mode: hold reports press and release (press
				// starts, release stops), toggle reports only press.
				const registeredCommand =
					command.id === 'askOverlay'
						? ({
								...command,
								on: recordingMode === 'hold' ? 'Both' : 'Pressed',
							} as Command)
						: command;

				return rpc.shortcuts.registerCommandGlobally.execute({
					accelerator,
					command: registeredCommand,
				});
			})
			.filter((result) => result !== undefined),
	);
	const { errs } = partitionResults(results);
	if (errs.length > 0) {
		rpc.notify.error.execute({
			title: 'Error registering global commands',
			description: errs.map((err) => err.error.message).join('\n'),
			action: { error: errs, type: 'more-details' },
		});
	}
}

/**
 * Synchronizes local keyboard shortcuts with the current settings.
 * - Registers shortcuts that have key combinations defined in settings
 * - Unregisters shortcuts that don't have key combinations defined
 * - Shows error toast if any registration/unregistration fails
 * COMMENTED OUT - Using global shortcuts only
 */
// export async function syncLocalShortcutsWithSettings() {
// 	const results = await Promise.all(
// 		commands
// 			.map((command) => {
// 				const keyCombination = settings.value[`shortcuts.local.${command.id}`];
// 				if (!keyCombination) {
// 					return rpc.shortcuts.unregisterCommandLocally.execute({
// 						commandId: command.id as CommandId,
// 					});
// 				}
// 				return rpc.shortcuts.registerCommandLocally.execute({
// 					command,
// 					keyCombination: shortcutStringToArray(keyCombination),
// 				});
// 			})
// 			.filter((result) => result !== undefined),
// 	);
// 	const { errs } = partitionResults(results);
// 	if (errs.length > 0) {
// 		rpc.notify.error.execute({
// 			title: 'Error registering local commands',
// 			description: errs.map((err) => err.error.message).join('\n'),
// 			action: { error: errs, type: 'more-details' },
// 		});
// 	}
// }
