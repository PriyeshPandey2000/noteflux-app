/**
 * Global store for the one-time "your Pro trial has ended" dialog. Opened
 * from +layout.svelte once, the first app-open after trial_ends_at has
 * passed and app.trialEndedNoticeShown is still false. See
 * docs/specs/20260916T160000-pro-trial-and-feature-gating.md.
 */

let isOpen = $state(false);

export const postTrialDialog = {
	get isOpen() {
		return isOpen;
	},

	set isOpen(value: boolean) {
		isOpen = value;
	},

	open() {
		isOpen = true;
	},

	close() {
		isOpen = false;
	},
};
