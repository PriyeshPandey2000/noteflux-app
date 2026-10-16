import type { Recording } from '$lib/services/db';
import type { DownloadServiceError } from '$lib/services/download';
import type { Result } from 'wellcrafted/result';

import { NoteFluxErr, type NoteFluxError } from '$lib/result';
import * as services from '$lib/services';

import { defineMutation } from './_client';

export const download = {
	downloadRecording: defineMutation({
		mutationKey: ['download', 'downloadRecording'] as const,
		resultMutationFn: async (
			recording: Recording,
		): Promise<Result<void, DownloadServiceError | NoteFluxError>> => {
			if (!recording.blob) {
				return NoteFluxErr({
					title: 'Recording blob not found',
					description: "Your recording doesn't have a blob to download.",
				});
			}

			return await services.download.downloadBlob({
				blob: recording.blob,
				name: `noteflux_recording_${recording.id}`,
			});
		},
	}),
};
