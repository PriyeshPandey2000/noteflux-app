/**
 * Recording state constants and schemas
 */
import RecordingWaveformIcon from '$lib/components/RecordingWaveformIcon.svelte';
import AudioLinesIcon from '@lucide/svelte/icons/audio-lines';
import EarIcon from '@lucide/svelte/icons/ear';
import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
import type { Component } from 'svelte';
import { z } from 'zod';

export const recordingStateSchema = z.enum(['IDLE', 'RECORDING']);

export type CancelRecordingResult =
	| { status: 'cancelled' }
	| { status: 'no-recording' };

export type NoteFluxRecordingState = z.infer<typeof recordingStateSchema>;

export const recorderStateToIcons = {
	IDLE: AudioLinesIcon,
	RECORDING: RecordingWaveformIcon,
} as const satisfies Record<NoteFluxRecordingState, Component>;

export const vadStateSchema = z.enum(['IDLE', 'LISTENING', 'SPEECH_DETECTED']);

export type VadState = z.infer<typeof vadStateSchema>;

export const vadStateToIcons = {
	IDLE: AudioLinesIcon,
	LISTENING: MessageCircleIcon,
	SPEECH_DETECTED: EarIcon,
} as const satisfies Record<VadState, Component>;
