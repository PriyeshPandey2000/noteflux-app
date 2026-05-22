import { Ok, tryAsync } from 'wellcrafted/result';

// import { extension } from '@repo/extension';
import type { ClipboardService } from '.';

import { ClipboardServiceErr } from './types';
// import { NoteFluxErr } from '$lib/result';

export function createClipboardServiceWeb(): ClipboardService {
	return {
		copyToClipboard: async (text) => {
			const { error: copyError } = await tryAsync({
				mapErr: (error) =>
					ClipboardServiceErr({
						cause: error,
						context: { text },
						message:
							'There was an error copying to the clipboard using the browser Clipboard API. Please try again.',
					}),
				try: () => navigator.clipboard.writeText(text),
			});

			if (copyError) {
				// Extension fallback code commented out for now
				// Could be re-enabled if extension support is needed
				return Ok(undefined);
			}
			return Ok(undefined);
		},

		typeAtCursor: async (text) => {
			// In web browsers, we cannot simulate typing for security reasons
			// Fall back to clipboard-based approach 
			return ClipboardServiceErr({
				cause: undefined,
				context: { text },
				message:
					'Automatic typing is not supported in web browsers for security reasons. Please paste manually using Cmd/Ctrl+V.',
			});
		},

		pasteFromClipboard: async () => {
			// In web browsers, we cannot programmatically paste for security reasons
			// The user must manually paste with Cmd/Ctrl+V
			return ClipboardServiceErr({
				cause: undefined,
				message:
					'Automatic paste is not supported in web browsers for security reasons. Please paste manually using Cmd/Ctrl+V.',
			});
		},

		getSelectionWithContext: async () => null,
	};
}
