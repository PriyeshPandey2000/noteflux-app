/**
 * Transcription service configurations
 */
import type { Settings } from '$lib/settings';

import {
	DEEPGRAM_TRANSCRIPTION_MODELS,
	type DeepgramModel,
} from '$lib/services/transcription/deepgram';
import {
	ELEVENLABS_TRANSCRIPTION_MODELS,
	type ElevenLabsModel,
} from '$lib/services/transcription/elevenlabs';
import { GROQ_MODELS, type GroqModel } from '$lib/services/transcription/groq';
import {
	OPENAI_TRANSCRIPTION_MODELS,
	type OpenAIModel,
} from '$lib/services/transcription/openai';
import { CloudIcon, HexagonIcon, PauseIcon, ServerIcon } from '@lucide/svelte';

type TranscriptionModel = DeepgramModel | ElevenLabsModel | GroqModel | OpenAIModel;

export const TRANSCRIPTION_SERVICE_IDS = [
	'OpenAI',
	'Groq',
	'speaches',
	'ElevenLabs',
	'Deepgram',
	'Qwen3ASR',
] as const;

type ApiTranscriptionService = BaseTranscriptionService & {
	apiKeyField: keyof Settings;
	defaultModel: TranscriptionModel;
	models: readonly TranscriptionModel[];
	modelSettingKey: string;
	type: 'api';
};

type BaseTranscriptionService = {
	icon: unknown;
	id: TranscriptionServiceId;
	name: string;
};

type LocalTranscriptionService = BaseTranscriptionService & {
	type: 'local';
};

type SatisfiedTranscriptionService =
	| ApiTranscriptionService
	| LocalTranscriptionService
	| ServerTranscriptionService;

type ServerTranscriptionService = BaseTranscriptionService & {
	serverUrlField: keyof Settings;
	type: 'server';
};

type TranscriptionServiceId = (typeof TRANSCRIPTION_SERVICE_IDS)[number];

export const TRANSCRIPTION_SERVICES = [
	{
		apiKeyField: 'apiKeys.groq',
		defaultModel: GROQ_MODELS[1],
		icon: CloudIcon,
		id: 'Groq',
		models: GROQ_MODELS,
		modelSettingKey: 'transcription.groq.model',
		name: 'Groq Whisper',
		type: 'api',
	},
	{
		icon: HexagonIcon,
		id: 'Qwen3ASR',
		name: 'Qwen3-ASR (Local)',
		type: 'local',
	},
	// COMMENTED OUT: BYOK providers - using only Groq for SaaS model
	// {
	// 	apiKeyField: 'apiKeys.openai',
	// 	defaultModel: OPENAI_TRANSCRIPTION_MODELS[0],
	// 	icon: HexagonIcon,
	// 	id: 'OpenAI',
	// 	models: OPENAI_TRANSCRIPTION_MODELS,
	// 	modelSettingKey: 'transcription.openai.model',
	// 	name: 'OpenAI Whisper',
	// 	type: 'api',
	// },
	// {
	// 	apiKeyField: 'apiKeys.elevenlabs',
	// 	defaultModel: ELEVENLABS_TRANSCRIPTION_MODELS[0],
	// 	icon: PauseIcon,
	// 	id: 'ElevenLabs',
	// 	models: ELEVENLABS_TRANSCRIPTION_MODELS,
	// 	modelSettingKey: 'transcription.elevenlabs.model',
	// 	name: 'ElevenLabs',
	// 	type: 'api',
	// },
	// {
	// 	icon: ServerIcon,
	// 	id: 'speaches',
	// 	name: 'Speaches',
	// 	serverUrlField: 'transcription.speaches.baseUrl',
	// 	type: 'server',
	// },
	// {
	// 	apiKeyField: 'apiKeys.deepgram',
	// 	defaultModel: DEEPGRAM_TRANSCRIPTION_MODELS[0],
	// 	icon: ServerIcon,
	// 	id: 'Deepgram',
	// 	models: DEEPGRAM_TRANSCRIPTION_MODELS,
	// 	modelSettingKey: 'transcription.deepgram.model',
	// 	name: 'Deepgram',
	// 	type: 'api',
	// },
] as const satisfies SatisfiedTranscriptionService[];

export const TRANSCRIPTION_SERVICE_OPTIONS = TRANSCRIPTION_SERVICES.map(
	(service) => ({
		label: service.name,
		value: service.id,
	}),
);

export type TranscriptionService = (typeof TRANSCRIPTION_SERVICES)[number];
