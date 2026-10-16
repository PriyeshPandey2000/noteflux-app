import type { HttpService } from '$lib/services/http';
import type { Settings } from '$lib/settings';

import { NoteFluxErr, type NoteFluxError } from '$lib/result';
import { HttpServiceLive } from '$lib/services/http';
import { Err, Ok, type Result } from 'wellcrafted/result';
import { z } from 'zod';

export const DEEPGRAM_TRANSCRIPTION_MODELS = [
    {
        description:
            "Deepgram's most advanced speech-to-text model with superior accuracy and speed. Best for high-quality transcription needs.",
        cost: '$0.0059/minute',
        name: 'nova-2',
    },
    {
        description:
            'Deepgram Nova model with excellent accuracy and performance. Good balance of speed and quality.',
        cost: '$0.0043/minute',
        name: 'nova',
    },
    {
        description:
            'Enhanced general-purpose model with good accuracy for most use cases. Cost-effective option.',
        cost: '$0.0025/minute',
        name: 'enhanced',
    },
    {
        description:
            'Base model for standard transcription needs. Most cost-effective option with reasonable accuracy.',
        cost: '$0.0020/minute',
        name: 'base',
    },
] as const satisfies {
    cost: string;
    description: string;
    name: string;
}[];

export type DeepgramModel = (typeof DEEPGRAM_TRANSCRIPTION_MODELS)[number];

const MAX_FILE_SIZE_MB = 500 as const; // Deepgram supports larger files

// Schema for Deepgram API response
const deepgramResponseSchema = z.object({
    results: z.object({
        channels: z.array(z.object({
            alternatives: z.array(z.object({
                confidence: z.number().optional(),
                transcript: z.string(),
            })),
        })),
    }),
});

export type DeepgramTranscriptionService = ReturnType<
    typeof createDeepgramTranscriptionService
>;

export function createDeepgramTranscriptionService({
    HttpService,
}: {
    HttpService: HttpService;
}) {
    return {
        async transcribe(
            audioBlob: Blob,
            options: {
                apiKey: string;
                modelName: DeepgramModel['name'] | (string & {});
                outputLanguage: Settings['transcription.outputLanguage'];
                prompt: string;
                temperature: string;
            },
        ): Promise<Result<string, NoteFluxError>> {
            // Pre-validation: Check API key
            if (!options.apiKey) {
                return NoteFluxErr({
                    title: 'API Key Required',
                    description:
                        'Please enter your Deepgram API key in settings to use Deepgram transcription.',
                    action: {
                        href: '/settings/transcription',
                        label: 'Add API key',
                        type: 'link',
                    },
                });
            }

            // Validate file size
            const blobSizeInMb = audioBlob.size / (1024 * 1024);
            if (blobSizeInMb > MAX_FILE_SIZE_MB) {
                return NoteFluxErr({
                    title: `The file size (${blobSizeInMb}MB) is too large`,
                    description: `Please upload a file smaller than ${MAX_FILE_SIZE_MB}MB.`,
                });
            }

            // Build query parameters
            const params = new URLSearchParams({
                model: options.modelName,
                paragraphs: 'true',
                punctuate: 'true',
                smart_format: 'true',
            });

            if (options.outputLanguage !== 'auto') {
                params.append('language', options.outputLanguage);
            }
            
            if (options.prompt) {
                params.append('keywords', options.prompt);
            }

            // Send raw audio data directly as recommended by Deepgram docs
            const { data: deepgramResponse, error: postError } = await HttpService.post({
                body: audioBlob, // Send raw audio blob directly
                headers: {
                    'Authorization': `Token ${options.apiKey}`,
                    'Content-Type': audioBlob.type || 'audio/*', // Use the blob's mime type or fallback to audio/*
                },
                schema: deepgramResponseSchema,
                url: `https://api.deepgram.com/v1/listen?${params.toString()}`,
            });

            if (postError) {
                switch (postError.name) {
                    case 'ConnectionError': {
                        return NoteFluxErr({
                            title: 'Connection Issue',
                            description:
                                'Unable to connect to Deepgram service. Please check your internet connection.',
                            action: { error: postError.cause, type: 'more-details' },
                        });
                    }

                    case 'ParseError':
                        return NoteFluxErr({
                            title: 'Response Error',
                            description:
                                'Received an unexpected response from Deepgram service. Please try again.',
                            action: { error: postError.cause, type: 'more-details' },
                        });

                    case 'ResponseError': {
                        const { message, status } = postError;

                        if (status === 400) {
                            return NoteFluxErr({
                                title: 'Bad Request',
                                description:
                                    message || 'Invalid request parameters. Please check your audio file and settings.',
                                action: { error: postError.cause, type: 'more-details' },
                            });
                        }

                        if (status === 401) {
                            return NoteFluxErr({
                                title: 'Authentication Failed',
                                description:
                                    'Your Deepgram API key is invalid or expired. Please update your API key in settings.',
                                action: {
                                    href: '/settings/transcription',
                                    label: 'Update API key',
                                    type: 'link',
                                },
                            });
                        }

                        if (status === 403) {
                            return NoteFluxErr({
                                title: 'Access Denied',
                                description:
                                    message || 'Your account does not have access to this feature or model.',
                                action: { error: postError.cause, type: 'more-details' },
                            });
                        }

                        if (status === 413) {
                            return NoteFluxErr({
                                title: 'Audio File Too Large',
                                description:
                                    'Your audio file exceeds the maximum size limit. Try splitting it into smaller segments.',
                                action: { error: postError.cause, type: 'more-details' },
                            });
                        }

                        if (status === 415) {
                            return NoteFluxErr({
                                title: 'Unsupported Format',
                                description:
                                    "This audio format isn't supported. Please convert your file to a supported format.",
                                action: { error: postError.cause, type: 'more-details' },
                            });
                        }

                        if (status === 429) {
                            return NoteFluxErr({
                                title: 'Rate Limit Reached',
                                description:
                                    'Too many requests. Please wait before trying again.',
                                action: { error: postError.cause, type: 'more-details' },
                            });
                        }

                        if (status && status >= 500) {
                            return NoteFluxErr({
                                title: 'Service Unavailable',
                                description:
                                    `The Deepgram service is temporarily unavailable (Error ${status}). Please try again later.`,
                                action: { error: postError.cause, type: 'more-details' },
                            });
                        }

                        return NoteFluxErr({
                            title: 'Transcription Failed',
                            description:
                                message || 'An unexpected error occurred during transcription. Please try again.',
                            action: { error: postError.cause, type: 'more-details' },
                        });
                    }

                    default:
                        return NoteFluxErr({
                            title: 'Unexpected Error',
                            description:
                                'An unexpected error occurred during transcription. Please try again.',
                            action: { error: postError, type: 'more-details' },
                        });
                }
            }

            // Extract transcription text
            const transcript = deepgramResponse.results?.channels?.[0]?.alternatives?.[0]?.transcript;

            if (!transcript) {
                return NoteFluxErr({
                    title: 'No Transcription Found',
                    description: 'No speech was detected in the audio file. Please check your audio and try again.',
                });
            }

            return Ok(transcript.trim());
        },
    };
}


export const DeepgramTranscriptionServiceLive =
    createDeepgramTranscriptionService({
        HttpService: HttpServiceLive,
    });
