import { IS_MACOS } from '$lib/constants/platform';

export function keyToLabel(key: string): string {
	switch (key) {
		case 'meta':
			return IS_MACOS ? 'Command' : 'Win';
		case 'alt':
			return IS_MACOS ? 'Option' : 'Alt';
		case 'control':
			return 'Ctrl';
		case 'shift':
			return 'Shift';
		case 'fn':
			return 'Fn';
		case 'altgraph':
			return 'AltGr';
		case ' ':
			return 'Space';
		default:
			return key.length === 1 ? key.toUpperCase() : key;
	}
}
