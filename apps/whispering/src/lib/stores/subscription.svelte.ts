import { authService } from '$lib/services/auth';
import {
  createCheckoutSession,
  fetchSubscriptionStatus,
  openCheckoutUrl,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from '$lib/services/subscription/dodo';
import { auth } from '$lib/stores/auth.svelte';
import { setAlwaysOnTopSuspended } from '$lib/stores/alwaysOnTop.svelte';

const FREE_SUBSCRIPTION: SubscriptionStatus = {
  tier: 'free',
  isActive: false,
  subscriptionId: null,
  currentPeriodEnd: null,
};

let subscriptionState = $state<SubscriptionStatus>(FREE_SUBSCRIPTION);
let isKnown = $state(false);
let checkoutInFlight = $state(false);
let refreshInFlight = false;

async function refresh() {
  const user = auth.user;
  const accessToken = auth.state.session?.access_token;

  // Signed out or anonymous users are genuinely free; nothing to confirm.
  if (!user || !accessToken || user.isAnonymous) {
    subscriptionState = FREE_SUBSCRIPTION;
    isKnown = true;
    return;
  }

  // A refresh for another account is already running; it will re-run for this one.
  if (refreshInFlight) {
    return;
  }

  refreshInFlight = true;
  const requestedUserId = user.id;
  let stale = false;

  // Unknown until the fetch confirms free/pro, so subscribe buttons never
  // flash for a user who is actually Pro.
  isKnown = false;
  try {
    const result = await fetchSubscriptionStatus(requestedUserId, accessToken);
    stale = auth.user?.id !== requestedUserId;
    if (!stale) {
      subscriptionState = result ?? FREE_SUBSCRIPTION;
      isKnown = result !== null;
    }
  } finally {
    refreshInFlight = false;
    if (stale) {
      void refresh();
    }
  }
}

// Re-check whenever auth changes (sign in/out, session refresh).
authService.onAuthStateChange(() => {
  void refresh();
});

// Re-check when the window regains focus (e.g. returning from checkout) and
// lift the always-on-top suspension so the persistent policy is re-applied.
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    setAlwaysOnTopSuspended(false);
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

  // Whether the current tier has been confirmed. Until confirmed, an existing
  // Pro user must not be treated as free.
  get isKnown() {
    return isKnown;
  },

  get isPro() {
    return isKnown && subscriptionState.tier === 'pro' && subscriptionState.isActive;
  },

  get isCheckoutInFlight() {
    return checkoutInFlight;
  },

  get currentPeriodEnd() {
    return subscriptionState.currentPeriodEnd;
  },

  async checkSubscription() {
    await refresh();
  },

  async openCheckout(plan: SubscriptionPlan) {
    // Only allow checkout once free status is confirmed, and never twice at once.
    if (checkoutInFlight || !isKnown || subscriptionState.tier !== 'free') {
      return;
    }

    const accessToken = auth.state.session?.access_token;
    if (!accessToken) {
      return;
    }

    checkoutInFlight = true;
    try {
      const checkoutUrl = await createCheckoutSession(accessToken, plan);
      if (!checkoutUrl) {
        return;
      }
      await openCheckoutUrl(checkoutUrl);
    } finally {
      checkoutInFlight = false;
    }
  },
};