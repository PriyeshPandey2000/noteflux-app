import { onboardingStore } from '$lib/stores/onboarding.svelte';

/**
 * Whether the current call should be treated as Pro-tier because it's one
 * of the two onboarding demo actions (cloud transcription, inline-edit),
 * not because of a real subscription or trial. No credit counter, no
 * server round-trip — bounded naturally by the onboarding step machine
 * itself (exactly these two steps, then a forced signup wall with no
 * anonymous way around it), not by counting calls. Retrying a failed
 * attempt costs nothing extra; there's nothing to run out of.
 * See docs/specs/20260925T113952-anonymous-14-day-trial.md.
 */
export function isOnboardingDemoStep(): boolean {
	return (
		onboardingStore.isOpen &&
		(onboardingStore.currentStep === 'usage-guide' ||
			onboardingStore.currentStep === 'inline-edit')
	);
}
