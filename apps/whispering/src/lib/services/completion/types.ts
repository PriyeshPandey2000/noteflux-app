import type { Result } from 'wellcrafted/result';

import { createTaggedError } from 'wellcrafted/error';

export const { CompletionServiceErr, CompletionServiceError } =
	createTaggedError('CompletionServiceError');

export type CompletionResult = {
	text: string;
	inputTokens: number;
	outputTokens: number;
};

export type CompletionService = {
	complete: (opts: {
		apiKey: string;
		model: string;
		systemPrompt: string;
		userPrompt: string;
	}) => Promise<Result<CompletionResult, CompletionServiceError>>;
};

export type CompletionServiceError = ReturnType<typeof CompletionServiceError>;
