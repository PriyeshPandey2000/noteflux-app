import { invoke } from '@tauri-apps/api/core';

export async function showNotchStatus(title: string, detail?: string) {
	if (!window.__TAURI_INTERNALS__) return;
	await invoke('show_notch_status', { text: title, detail: detail ?? null }).catch(
		(error) => console.error('Failed to show notch status:', error),
	);
}

export async function hideNotchStatus() {
	if (!window.__TAURI_INTERNALS__) return;
	await invoke('hide_notch_status').catch((error) =>
		console.error('Failed to hide notch status:', error),
	);
}
