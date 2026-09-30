import Groq from 'groq-sdk';
import { Err, Ok, tryAsync } from 'wellcrafted/result';

import { CompletionServiceErr } from './types';

const NOTEFLUX_API_URL = 'https://noteflux.app';

type CompleteOptions = {
	// Present for BYOK (user's own key, calls Groq directly). Absent for the
	// embedded/SaaS path, which proxies through noteflux.app using accessToken
	// instead, so no Groq key ever ships to the client.
	apiKey?: string;
	accessToken?: string;
	model: string;
	systemPrompt: string;
	userPrompt: string;
};

async function completeViaProxy({
	accessToken,
	model,
	systemPrompt,
	userPrompt,
}: CompleteOptions) {
	if (!accessToken) {
		return CompletionServiceErr({
			cause: undefined,
			context: {},
			message: 'Please sign in to use this feature.',
		});
	}

	const { data: response, error: fetchError } = await tryAsync({
		mapErr: (error) =>
			CompletionServiceErr({
				cause: error,
				context: {},
				message:
					'Unable to reach the completion service. This could be a network issue or temporary service interruption.',
			}),
		try: () =>
			fetch(`${NOTEFLUX_API_URL}/api/groq/chat`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ model, systemPrompt, userPrompt }),
			}),
	});

	if (fetchError) return Err(fetchError);

	const body = await response.json();

	if (!response.ok) {
		return CompletionServiceErr({
			cause: body,
			context: { status: response.status },
			message: body.description ?? `Request failed (${response.status}).`,
		});
	}

	return Ok({
		text: body.text,
		inputTokens: body.inputTokens ?? 0,
		outputTokens: body.outputTokens ?? 0,
	});
}

export function createGroqCompletionService() {
	return {
		async complete(options: CompleteOptions) {
			const { apiKey, model, systemPrompt, userPrompt } = options;
			if (!apiKey) return completeViaProxy(options);

			const client = new Groq({ apiKey, dangerouslyAllowBrowser: true });
			// Call Groq API
			const { data: completion, error: groqApiError } = await tryAsync({
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
					client.chat.completions.create({
						messages: [
							{ content: systemPrompt, role: 'system' },
							{ content: userPrompt, role: 'user' },
						],
						model,
					}),
			});

			if (groqApiError) {
				// Error handling follows https://www.npmjs.com/package/groq-sdk#error-handling
				const { message, error, name, status } = groqApiError;

				// 400 - BadRequestError
				if (status === 400) {
					return CompletionServiceErr({
						cause: groqApiError,
						context: { name, status },
						message:
							message ??
							`Invalid request to Groq API. ${error?.message ?? ''}`.trim(),
					});
				}

				// 401 - AuthenticationError
				if (status === 401) {
					return CompletionServiceErr({
						cause: groqApiError,
						context: { name, status },
						message:
							message ??
							'Your API key appears to be invalid or expired. Please update your API key in settings.',
					});
				}

				// 403 - PermissionDeniedError
				if (status === 403) {
					return CompletionServiceErr({
						cause: groqApiError,
						context: { name, status },
						message:
							message ??
							"Your account doesn't have access to this model or feature.",
					});
				}

				// 404 - NotFoundError
				if (status === 404) {
					return CompletionServiceErr({
						cause: groqApiError,
						context: { name, status },
						message:
							message ??
							'The requested model was not found. Please check the model name.',
					});
				}

				// 422 - UnprocessableEntityError
				if (status === 422) {
					return CompletionServiceErr({
						cause: groqApiError,
						context: { name, status },
						message:
							message ??
							'The request was valid but the server cannot process it. Please check your parameters.',
					});
				}

				// 429 - RateLimitError
				if (status === 429) {
					return CompletionServiceErr({
						cause: groqApiError,
						context: { name, status },
						message: message ?? 'Too many requests. Please try again later.',
					});
				}

				// >=500 - InternalServerError
				if (status && status >= 500) {
					return CompletionServiceErr({
						cause: groqApiError,
						context: { name, status },
						message:
							message ??
							`The Groq service is temporarily unavailable (Error ${status}). Please try again in a few minutes.`,
					});
				}

				// Handle APIConnectionError (no status code)
				if (!status && name === 'APIConnectionError') {
					return CompletionServiceErr({
						cause: groqApiError,
						context: { name },
						message:
							message ??
							'Unable to connect to the Groq service. This could be a network issue or temporary service interruption.',
					});
				}

				// Catch-all for unexpected errors
				return CompletionServiceErr({
					cause: groqApiError,
					context: { name, status },
					message: message ?? 'An unexpected error occurred. Please try again.',
				});
			}

			// Extract the response text
			const responseText = completion.choices[0]?.message?.content;
			if (!responseText) {
				return CompletionServiceErr({
					cause: undefined,
					context: { completion, model },
					message: 'Groq API returned an empty response',
				});
			}

			return Ok({
				text: responseText,
				inputTokens: completion.usage?.prompt_tokens ?? 0,
				outputTokens: completion.usage?.completion_tokens ?? 0,
			});
		},
	};
}

export type GroqCompletionService = ReturnType<
	typeof createGroqCompletionService
>;

export const GroqCompletionServiceLive = createGroqCompletionService();
