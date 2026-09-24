import { auth } from '$lib/stores/auth.svelte';
import { onboardingStore } from '$lib/stores/onboarding.svelte';
import { supabase } from '$lib/services/auth/supabase-client';

// Steps where a real Pro-tier call (cloud transcription, inline-edit) is
// allowed for an anonymous/free session, gated by the server-side demo
// credit check below. Nowhere else — an onboarding step not in this list
// falls straight through to the normal free-tier behavior.
const ONBOARDING_DEMO_STEPS = ['usage-guide', 'inline-edit'] as const;

function isOnboardingDemoActive(): boolean {
	return (
		onboardingStore.isOpen &&
		(ONBOARDING_DEMO_STEPS as readonly string[]).includes(onboardingStore.currentStep)
	);
}

/**
 * Whether this specific call should be treated as Pro-tier.
 *
 * Real Pro/trial users short-circuit on `subscriptionHasProAccess` — zero
 * behavior change, no network call, same as today. Only when that's false
 * AND the onboarding demo is genuinely active does this try to consume one
 * shared demo credit via a server-side atomic check-and-increment
 * (`use_onboarding_demo_credit`). Fails closed on any error — a broken
 * check denies access, it never silently grants it.
 */
export async function hasEffectiveProAccess(
	subscriptionHasProAccess: boolean,
): Promise<boolean> {
	if (subscriptionHasProAccess) return true;

	if (!isOnboardingDemoActive()) return false;

	const userId = auth.user?.id;
	if (!userId) return false;

	try {
		const { data, error } = await supabase.rpc('use_onboarding_demo_credit', {
			p_user_id: userId,
		});
		if (error) {
			console.error('[onboarding-demo-access] credit check failed:', error);
			return false;
		}
		return data === true;
	} catch (error) {
		console.error('[onboarding-demo-access] credit check threw:', error);
		return false;
	}
}
