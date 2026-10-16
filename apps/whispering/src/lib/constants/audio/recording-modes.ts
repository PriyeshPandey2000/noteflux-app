/**
 * Recording mode constants and options
 */
import type { Component } from 'svelte';
import MicIcon from '@lucide/svelte/icons/mic';

export const RECORDING_MODES = [
	'manual',
	'vad',
	'upload',
	// 'live',
	// 'cpal'
] as const;
export type RecordingMode = (typeof RECORDING_MODES)[number];

export const RECORDING_MODE_OPTIONS = [
	{ desktopOnly: false, icon: MicIcon, label: 'Manual', value: 'manual' },
	// COMMENTED OUT: Voice Activated mode - will be added back after transformation integration
	// { desktopOnly: false, icon: '🎤', label: 'Voice Activated', value: 'vad' },
	// { desktopOnly: false, icon: '📁', label: 'Upload File', value: 'upload' },
	// { label: 'Live', value: 'live', icon: '🎬', desktopOnly: false },
	// { label: 'CPAL', value: 'cpal', icon: '🔊', desktopOnly: true },
] as const satisfies {
	desktopOnly: boolean;
	icon: Component;
	label: string;
	value: RecordingMode;
}[];
