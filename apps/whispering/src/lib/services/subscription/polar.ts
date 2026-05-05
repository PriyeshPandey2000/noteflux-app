import type { AuthUser } from '$lib/services/auth';

export type SubscriptionTier = 'free' | 'pro';

export type SubscriptionState = {
  tier: SubscriptionTier;
  isActive: boolean;
  subscriptionId: string | null;
};

let subscriptionState: SubscriptionState = {
  tier: 'free',
  isActive: false,
  subscriptionId: null,
};

export const subscription = {
  get state() {
    return subscriptionState;
  },

  get tier() {
    return subscriptionState.tier;
  },

  get isPro() {
    return subscriptionState.tier === 'pro' && subscriptionState.isActive;
  },

  setMockForTesting(state: SubscriptionState) {
    subscriptionState = state;
  },

  checkSubscription(isAuthenticated: boolean, isAnonymous: boolean) {
    if (!isAuthenticated) {
      subscriptionState = { tier: 'free', isActive: false, subscriptionId: null };
      return;
    }

    if (isAnonymous) {
      subscriptionState = { tier: 'free', isActive: false, subscriptionId: null };
      return;
    }

    // TODO: Replace with real API call to check subscription status
    // For now, return free so Subscribe button shows
    // Change to { tier: 'pro', isActive: true, subscriptionId: 'mock' } to test Pro badge
    subscriptionState = { tier: 'free', isActive: false, subscriptionId: null };
  },

  async openCheckout(user: AuthUser | null) {
    const checkoutUrl = `https://noteflux.app/checkout?user_id=${user?.id || ''}`;

    // Use Tauri opener if in desktop app
    if ((window as any).__TAURI_INTERNALS__) {
      try {
        // Disable always-on-top so browser is visible
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          await getCurrentWindow().setAlwaysOnTop(false);
        } catch (e) {
          console.log('Could not disable always on top:', e);
        }

        const openerModule = await import('@tauri-apps/plugin-opener');
        if (openerModule.openUrl) {
          await openerModule.openUrl(checkoutUrl);
          return;
        }
      } catch (e) {
        console.error('Tauri opener failed, falling back to window.open:', e);
      }
    }

    // Fallback to web browser
    window.open(checkoutUrl, '_blank');
  }
};