import type { Settings } from '$lib/settings';

import { NoteFluxErr, type NoteFluxError } from '$lib/result';
import { getExtensionFromAudioBlob } from '$lib/services/_utils';
import Groq from 'groq-sdk';
import { Err, Ok, type Result, tryAsync, trySync } from 'wellcrafted/result';

export const GROQ_MODELS = [
	{
		description:
			'Highest accuracy and state-of-the-art performance for multilingual transcription. Slower processing but best quality results.',
		cost: 'Multilingual',
		name: 'Whisper Large V3',
		modelId: 'whisper-large-v3',
	},
	{
		description:
			'Faster processing with good accuracy for multilingual transcription. Optimized for speed while maintaining quality.',
		cost: 'Multilingual',
		name: 'Whisper Large V3 Turbo',
		modelId: 'whisper-large-v3-turbo',
	},
] as const;

export type GroqModel = (typeof GROQ_MODELS)[number];

const MAX_FILE_SIZE_MB = 25 as const;
// Vercel's hard platform limit for a function request body, on both Node and
// Edge runtimes. Not configurable — this is why the proxy path enforces a
// tighter cap than the direct-to-Groq (BYOK) path above.
const MAX_PROXY_FILE_SIZE_MB = 4 as const;
const NOTEFLUX_API_URL = 'https://noteflux.app';

type TranscribeOptions = {
	// Present for BYOK (user's own key, calls Groq directly). Absent for the
	// embedded/SaaS path, which proxies through noteflux.app using accessToken
	// instead, so no Groq key ever ships to the client.
	apiKey?: string;
	accessToken?: string;
	modelName: GroqModel['name'] | (string & {});
	outputLanguage: Settings['transcription.outputLanguage'];
	prompt: string;
	temperature: string;
};

async function transcribeViaProxy(
	audioBlob: Blob,
	options: TranscribeOptions,
): Promise<Result<string, NoteFluxError>> {
	if (!options.accessToken) {
		return NoteFluxErr({
			title: '🔑 Sign In Required',
			description: 'Please sign in to use cloud transcription.',
		});
	}

	const blobSizeInMb = audioBlob.size / (1024 * 1024);
	if (blobSizeInMb > MAX_PROXY_FILE_SIZE_MB) {
		return NoteFluxErr({
			title: 'Recording too large for cloud transcription',
			description: `Please keep cloud recordings under ${MAX_PROXY_FILE_SIZE_MB}MB, or switch to local transcription for longer recordings.`,
		});
	}

	const { data: file, error: fileError } = trySync({
		mapErr: (error) =>
			NoteFluxErr({
				title: '📄 File Creation Failed',
				description:
					'Failed to create audio file for transcription. Please try again.',
				action: { error, type: 'more-details' },
			}),
		try: () =>
			new File(
				[audioBlob],
				`recording.${getExtensionFromAudioBlob(audioBlob)}`,
				{ type: audioBlob.type },
			),
	});

	if (fileError) return Err(fileError);

	const formData = new FormData();
	formData.append('file', file);
	formData.append(
		'model',
		GROQ_MODELS.find((m) => m.name === options.modelName)?.modelId ||
			options.modelName,
	);
	if (options.outputLanguage !== 'auto')
		formData.append('language', options.outputLanguage);
	if (options.prompt) formData.append('prompt', options.prompt);
	if (options.temperature) formData.append('temperature', options.temperature);

	const { data: response, error: fetchError } = await tryAsync({
		mapErr: (error) =>
			NoteFluxErr({
				title: '🌐 Connection Issue',
				description:
					'Unable to reach the transcription service. This could be a network issue or temporary service interruption.',
				action: { error, type: 'more-details' },
			}),
		try: () =>
			fetch(`${NOTEFLUX_API_URL}/api/groq/transcribe`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${options.accessToken}` },
				body: formData,
			}),
	});

	if (fetchError) return Err(fetchError);

	const body = await response.json();

	if (!response.ok) {
		return NoteFluxErr({
			title: body.title ?? '❌ Transcription Failed',
			description: body.description ?? `Request failed (${response.status}).`,
		});
	}

	return Ok(body.text.trim());
}

export type GroqTranscriptionService = ReturnType<
	typeof createGroqTranscriptionService
>;

export function createGroqTranscriptionService() {
	return {
		async transcribe(
			audioBlob: Blob,
			options: TranscribeOptions,
		): Promise<Result<string, NoteFluxError>> {
			if (!options.apiKey) return transcribeViaProxy(audioBlob, options);

			if (!options.apiKey.startsWith('gsk_')) {
				return NoteFluxErr({
					title: '🔑 Invalid API Key Format',
					description:
						'Your Groq API key should start with "gsk_". Please check and update your API key.',
					action: {
						href: '/settings/transcription',
						label: 'Update API key',
						type: 'link',
					},
				});
			}

			// Check file size
			const blobSizeInMb = audioBlob.size / (1024 * 1024);
			if (blobSizeInMb > MAX_FILE_SIZE_MB) {
				return NoteFluxErr({
					title: `The file size (${blobSizeInMb}MB) is too large`,
					description: `Please upload a file smaller than ${MAX_FILE_SIZE_MB}MB.`,
				});
			}

			// Create file from blob
			const { data: file, error: fileError } = trySync({
				mapErr: (error) =>
					NoteFluxErr({
						title: '📄 File Creation Failed',
						description:
							'Failed to create audio file for transcription. Please try again.',
						action: { error, type: 'more-details' },
					}),
				try: () =>
					new File(
						[audioBlob],
						`recording.${getExtensionFromAudioBlob(audioBlob)}`,
						{ type: audioBlob.type },
					),
			});

			if (fileError) return Err(fileError);

			// Make the transcription request
			const { data: transcription, error: groqApiError } = await tryAsync({
				mapErr: (error) => {
					// Check if it's NOT a Groq API error
					if (!(error instanceof Groq.APIError)) {
						// This is an unexpected error type
						throw error;
					}
					// Return the error directly
					return Err(error);
				},
				try: () =>
					new Groq({
						apiKey: options.apiKey,
						dangerouslyAllowBrowser: true,
					}).audio.transcriptions.create({
						file,
						language:
							options.outputLanguage === 'auto'
								? undefined
								: options.outputLanguage,
						model: GROQ_MODELS.find(m => m.name === options.modelName)?.modelId || options.modelName,
						prompt: options.prompt ? options.prompt : undefined,
						temperature: options.temperature
							? Number.parseFloat(options.temperature)
							: undefined,
					}),
			});

			if (groqApiError) {
				// Error handling follows https://www.npmjs.com/package/groq-sdk#error-handling
				const { message, error, name, status } = groqApiError;

				// 400 - BadRequestError
				if (status === 400) {
					return NoteFluxErr({
						title: '❌ Bad Request',
						description:
							message ??
							`Invalid request to Groq API. ${error?.message ?? ''}`.trim(),
						action: { error: groqApiError, type: 'more-details' },
					});
				}

				// 401 - AuthenticationError
				if (status === 401) {
					return NoteFluxErr({
						title: '🔑 Authentication Required',
						description:
							message ??
							'Your API key appears to be invalid or expired. Please update your API key in settings to continue transcribing.',
						action: {
							href: '/settings/transcription',
							label: 'Update API key',
							type: 'link',
						},
					});
				}

				// 403 - PermissionDeniedError
				if (status === 403) {
					return NoteFluxErr({
						title: '⛔ Permission Denied',
						description:
							message ??
							"Your account doesn't have access to this feature. This may be due to plan limitations or account restrictions.",
						action: { error: groqApiError, type: 'more-details' },
					});
				}

				// 404 - NotFoundError
				if (status === 404) {
					return NoteFluxErr({
						title: '🔍 Not Found',
						description:
							message ??
							'The requested resource was not found. This might indicate an issue with the model or API endpoint.',
						action: { error: groqApiError, type: 'more-details' },
					});
				}

				// 422 - UnprocessableEntityError
				if (status === 422) {
					return NoteFluxErr({
						title: '⚠️ Invalid Input',
						description:
							message ??
							'The request was valid but the server cannot process it. Please check your audio file and parameters.',
						action: {
							href: '/settings/transcription',
							label: 'Update API key',
							type: 'link',
						},
					});
				}

				// 429 - RateLimitError
				if (status === 429) {
					return NoteFluxErr({
						title: '⏱️ Rate Limit Reached',
						description:
							message ?? 'Too many requests. Please try again later.',
						action: {
							href: '/settings/transcription',
							label: 'Update API key',
							type: 'link',
						},
					});
				}

				// >=500 - InternalServerError
				if (status && status >= 500) {
					return NoteFluxErr({
						title: '🔧 Service Unavailable',
						description:
							message ??
							`The transcription service is temporarily unavailable (Error ${status}). Please try again in a few minutes.`,
						action: { error: groqApiError, type: 'more-details' },
					});
				}

				// Handle APIConnectionError (no status code)
				if (!status && name === 'APIConnectionError') {
					return NoteFluxErr({
						title: '🌐 Connection Issue',
						description:
							message ??
							'Unable to connect to the Groq service. This could be a network issue or temporary service interruption.',
						action: { error: groqApiError, type: 'more-details' },
					});
				}

				// Return the error directly for other API errors
				return NoteFluxErr({
					title: '❌ Unexpected Error',
					description:
						message ?? 'An unexpected error occurred. Please try again.',
					action: { error: groqApiError, type: 'more-details' },
				});
			}

			return Ok(transcription.text.trim());
		},
	};
}

export const GroqTranscriptionServiceLive = createGroqTranscriptionService();
