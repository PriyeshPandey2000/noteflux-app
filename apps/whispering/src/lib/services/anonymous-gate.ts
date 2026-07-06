import { supabase } from './auth/supabase-client';
import { auth } from '$lib/stores/auth.svelte';

type GateStatus = { needsSignup: boolean; totalMinutes: number };

let cache: GateStatus | null = null;

async function fetchGateStatus(): Promise<GateStatus | null> {
	if (!auth.isAuthenticated) return null;
	if (!auth.isAnonymous) return { needsSignup: false, totalMinutes: 0 };

	const userId = auth.user?.id;
	if (!userId) return null;

	try {
		const { data: usageData, error } = await supabase
			.from('total_usage_limit')
			.select('total_minutes')
			.eq('user_id', userId)
			.single();

		if (error || !usageData) return { needsSignup: false, totalMinutes: 0 };

		const totalMinutes = usageData.total_minutes || 0;
		return { needsSignup: totalMinutes >= 5, totalMinutes };
	} catch {
		return { needsSignup: false, totalMinutes: 0 };
	}
}

/**
 * Returns cached gate status instantly. Falls back to network on first call.
 * Call refreshAnonymousGateCache() after each recording to keep it fresh.
 */
export async function checkAnonymousGate(): Promise<GateStatus | null> {
	if (cache !== null) return cache;
	cache = await fetchGateStatus();
	return cache;
}

/**
 * Fire-and-forget refresh after each recording completes.
 * Updates cache in background so next Fn press is instant.
 */
export function refreshAnonymousGateCache(): void {
	fetchGateStatus().then((result) => {
		cache = result;
	});
}
