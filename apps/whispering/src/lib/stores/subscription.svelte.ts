import { auth } from '$lib/stores/auth.svelte';
import { authService } from '$lib/services/auth';
import {
  fetchSubscriptionStatus,
  createCheckoutSession,
  openCheckoutUrl,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from '$lib/services/subscription/dodo';

const FREE_SUBSCRIPTION: SubscriptionStatus = {
  tier: 'free',
  isActive: false,
  subscriptionId: null,
  currentPeriodEnd: null,
};

let subscriptionState = $state<SubscriptionStatus>(FREE_SUBSCRIPTION);
let refreshInFlight = false;

async function refresh() {
  const user = auth.user;
  const accessToken = auth.state.session?.access_token;

  // No real user (signed out or anonymous) has no Pro subscription.
  if (!user || !accessToken || user.isAnonymous) {
    subscriptionState = FREE_SUBSCRIPTION;
    return;
  }

  if (refreshInFlight) {
    return;
  }
  refreshInFlight = true;
  subscriptionState = await fetchSubscriptionStatus(user.id, accessToken);
  refreshInFlight = false;
}

// Re-check whenever auth changes (sign in/out, session refresh).
authService.onAuthStateChange(() => {
  void refresh();
});

// Re-check when the window regains focus, e.g. returning from checkout.
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    void refresh();
  });
}

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

  get currentPeriodEnd() {
    return subscriptionState.currentPeriodEnd;
  },

  async checkSubscription() {
    await refresh();
  },

  async openCheckout(plan: SubscriptionPlan) {
    const accessToken = auth.state.session?.access_token;
    if (!accessToken) {
      return;
    }

    const checkoutUrl = await createCheckoutSession(accessToken, plan);
    if (!checkoutUrl) {
      return;
    }

    await openCheckoutUrl(checkoutUrl);
  },
};