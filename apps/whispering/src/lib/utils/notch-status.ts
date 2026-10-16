import { invoke } from '@tauri-apps/api/core';

// Reference-counted — transcribeRecordings runs multiple transcriptions
// concurrently via Promise.all, and each one shows/hides this shared status
// around its own warmup. Without counting, the first call to finish would
// hide the status while the others are still warming up, up to several
// minutes with no feedback.
let activeCount = 0;

export async function showNotchStatus(title: string, detail?: string) {
	activeCount++;
	if (!window.__TAURI_INTERNALS__) return;
	await invoke('show_notch_status', { text: title, detail: detail ?? null }).catch(
		(error) => console.error('Failed to show notch status:', error),
	);
}

export async function hideNotchStatus() {
	activeCount = Math.max(0, activeCount - 1);
	if (activeCount > 0) return;
	if (!window.__TAURI_INTERNALS__) return;
	await invoke('hide_notch_status').catch((error) =>
		console.error('Failed to hide notch status:', error),
	);
}
