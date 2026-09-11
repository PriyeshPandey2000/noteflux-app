/**
 * Store for managing the signup required dialog state.
 * Opened for two reasons:
 * - 'usage-limit': anonymous users who hit the 5-minute transcription limit
 * - 'pro': anonymous users who tapped "Get Pro" — once they finish signing
 *   up, the dialog chains straight into the Pro paywall instead of
 *   reopening onboarding.
 */

export type SignupRequiredReason = 'usage-limit' | 'pro';

let isOpen = $state(false);
let wasOnboardingOpen = $state(false);
let reason = $state<SignupRequiredReason>('usage-limit');

export const signupRequiredDialog = {
	get isOpen() {
		return isOpen;
	},

	// The 'pro' reason renders a dismissible dialog (Dialog internals close it
	// via this setter on escape/outside-click/close-button); 'usage-limit'
	// stays non-dismissible from the markup side, so this setter is never
	// invoked for that case.
	set isOpen(value: boolean) {
		if (!value) {
			this.close();
		}
	},

	get wasOnboardingOpen() {
		return wasOnboardingOpen;
	},

	get reason() {
		return reason;
	},

	open(onboardingWasOpen: boolean = false, openReason: SignupRequiredReason = 'usage-limit') {
		isOpen = true;
		wasOnboardingOpen = onboardingWasOpen;
		reason = openReason;
	},

	close() {
		isOpen = false;
		wasOnboardingOpen = false;
		reason = 'usage-limit';
	},
};
