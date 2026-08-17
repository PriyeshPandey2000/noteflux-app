import { rpc } from '$lib/query';

import type { ShortcutTriggerState } from './services/_shortcut-trigger-state';

type SatisfiedCommand = {
	callback: () => void;
	id: string;
	on: ShortcutTriggerState;
	title: string;
};

export const commands = [
	{
		title: 'Push to talk (hold to record)',
		callback: async () => {
			// Check if currently recording
			const { data: currentRecordingId } = await rpc.recorder.getCurrentRecordingId.fetch();

			if (currentRecordingId) {
				// Currently recording → stop on release
				await rpc.commands.stopManualRecording.execute(undefined);
			} else {
				// Not recording → start on press
				await rpc.commands.startManualRecording.execute({ initiatedVia: 'local' });
			}
		},
		id: 'pushToTalk',
		on: 'Both',
	},
	{
		title: 'Start/Stop recording (tap to toggle)',
		callback: () => rpc.commands.toggleManualRecording.execute(undefined),
		id: 'toggleManualRecording',
		on: 'Pressed',
	},
	// {
	// 	title: 'Start recording',
	// 	callback: () => rpc.commands.startManualRecording.execute(undefined),
	// 	id: 'startManualRecording',
	// 	on: 'Pressed',
	// },
	// {
	// 	title: 'Stop recording',
	// 	callback: () => rpc.commands.stopManualRecording.execute(undefined),
	// 	id: 'stopManualRecording',
	// 	on: 'Pressed',
	// },
	{
		title: 'Cancel recording',
		callback: () => rpc.commands.cancelManualRecording.execute(undefined),
		id: 'cancelManualRecording',
		on: 'Pressed',
	},
	// {
	// 	title: 'Start voice activated recording',
	// 	callback: () => rpc.commands.startVadRecording.execute(undefined),
	// 	id: 'startVadRecording',
	// 	on: 'Pressed',
	// },
	// {
	// 	title: 'Stop voice activated recording',
	// 	callback: () => rpc.commands.stopVadRecording.execute(undefined),
	// 	id: 'stopVadRecording',
	// 	on: 'Pressed',
	// },
	// {
	// 	title: 'Toggle voice activated recording',
	// 	callback: () => rpc.commands.toggleVadRecording.execute(undefined),
	// 	id: 'toggleVadRecording',
	// 	on: 'Pressed',
	// },
] as const satisfies SatisfiedCommand[];

export type Command = (typeof commands)[number];

type CommandCallbacks = Record<Command['id'], Command['callback']>;

export const commandCallbacks = commands.reduce<CommandCallbacks>(
	(acc, command) => {
		acc[command.id] = command.callback;
		return acc;
	},
	{} as CommandCallbacks,
);

// Track local state for instant feedback without backend roundtrip
let isRecordingOrStarting = false;
// Track pending start operation to ensure we don't try to stop before start finishes.
// Note: .execute() never throws — errors come back as { error } in the Result.
let pendingStartPromise: ReturnType<
	typeof rpc.commands.startManualRecording.execute
> | null = null;

// Global shortcut callbacks - these pass 'global-shortcut' as the initiation method
export const globalCommandCallbacks: CommandCallbacks = {
	pushToTalk: async () => {
		if (isRecordingOrStarting) {
			// --- STOP LOGIC (Release) ---
			// Immediately update local state so subsequent calls know we're stopping
			isRecordingOrStarting = false;

			// SAFETY: If we are still starting (e.g. quick tap), wait for start to finish first
			// This prevents the "stop before start" race condition
			if (pendingStartPromise) {
				const { error: startError } = await pendingStartPromise;
				pendingStartPromise = null;
				if (startError) {
					// Start failed — there is no recording to stop
					console.error('Start failed, cannot stop:', startError);
					return;
				}
			}

			// Now safely stop the recording
			await rpc.commands.stopManualRecording.execute(undefined);
		} else {
			// --- START LOGIC (Press) ---
			// Immediately mark as active so next call (Release) knows to stop
			isRecordingOrStarting = true;

			// Store the promise so the stop logic can wait for it if needed
			pendingStartPromise = rpc.commands.startManualRecording.execute({
				initiatedVia: 'global-shortcut',
			});

			const { error } = await pendingStartPromise;
			if (error) {
				// Start failed (auth, gate, mic error) — revert local state so the
				// next press starts fresh instead of being eaten by a no-op stop
				console.error('Start manual recording failed:', error);
				isRecordingOrStarting = false;
				pendingStartPromise = null;
			} else if (isRecordingOrStarting) {
				// Clear promise ref if we finished without a stop call intercepting it
				// (The stop logic might have already set this to null, which is fine)
				pendingStartPromise = null;
			}
		}
	},
	toggleManualRecording: () =>
		rpc.commands.toggleManualRecording.execute({
			initiatedVia: 'global-shortcut',
		}),
	cancelManualRecording: () => {
		// Reset local state when cancelling
		isRecordingOrStarting = false;
		pendingStartPromise = null;
		return rpc.commands.cancelManualRecording.execute({
			initiatedVia: 'global-shortcut',
		});
	},
};
