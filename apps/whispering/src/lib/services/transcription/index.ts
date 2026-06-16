import { DeepgramTranscriptionServiceLive } from './deepgram';
import { ElevenlabsTranscriptionServiceLive } from './elevenlabs';
import { GroqTranscriptionServiceLive } from './groq';
import { OpenaiTranscriptionServiceLive } from './openai';
import { Qwen3ASRServiceLive } from './qwen3-asr';
import { SpeachesTranscriptionServiceLive } from './speaches';

export {
	DeepgramTranscriptionServiceLive as deepgram,
	ElevenlabsTranscriptionServiceLive as elevenlabs,
	GroqTranscriptionServiceLive as groq,
	OpenaiTranscriptionServiceLive as openai,
	Qwen3ASRServiceLive as qwen3asr,
	SpeachesTranscriptionServiceLive as speaches,
};

export type { ElevenLabsTranscriptionService } from './elevenlabs';
export type { GroqTranscriptionService } from './groq';
export type { OpenaiTranscriptionService } from './openai';
export type { Qwen3ASRService } from './qwen3-asr';
export type { SpeachesTranscriptionService } from './speaches';
export type { DeepgramTranscriptionService } from './deepgram';