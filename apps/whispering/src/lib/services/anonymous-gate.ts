import { supabase } from './auth/supabase-client';
import { auth } from '$lib/stores/auth.svelte';

/**
 * Check if anonymous user has reached the 5-minute gate
 * Returns null if not anonymous or not authenticated
 */
export async function checkAnonymousGate(): Promise<{
  needsSignup: boolean;
  totalMinutes: number;
} | null> {
  try {
    if (!auth.isAuthenticated) {
      return null;
    }

    // Only check gate for anonymous users
    if (!auth.isAnonymous) {
      return { needsSignup: false, totalMinutes: 0 };
    }

    const userId = auth.user?.id;
    if (!userId) {
      return null;
    }

    // Get user's total transcribed minutes
    const { data: usageData, error: usageError } = await supabase
      .from('total_usage_limit')
      .select('total_minutes')
      .eq('user_id', userId)
      .single();

    if (usageError || !usageData) {
      // No usage yet
      return { needsSignup: false, totalMinutes: 0 };
    }

    const totalMinutes = usageData.total_minutes || 0;
    const needsSignup = totalMinutes >= 5;

    return { needsSignup, totalMinutes };
  } catch (error) {
    console.error('Error checking anonymous gate:', error);
    return null;
  }
}
