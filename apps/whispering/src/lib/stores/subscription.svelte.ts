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

const CACHE_PREFIX = 'noteflux_subscription_cache_v1:';

// Cache is keyed per userId so switching accounts never shows a stale status
// from a different account. Best-effort only: private browsing / storage
// caps can make read/write throw, and that must never break the real fetch.
function readCachedStatus(userId: string): SubscriptionStatus | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + userId);
    return raw ? (JSON.parse(raw) as SubscriptionStatus) : null;
  } catch {
    return null;
  }
}

function writeCachedStatus(userId: string, status: SubscriptionStatus) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CACHE_PREFIX + userId, JSON.stringify(status));
  } catch {
    // Ignore — worst case we just lose the fast-paint optimization.
  }
}

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

  // Paint instantly from this account's last confirmed status (if any)
  // while we reconfirm over the network, instead of leaving the UI in the
  // "unknown" state — which is what previously hid the Pro badge / buy
  // button until the noteflux.app round trip finished on every launch.
  // This can briefly show a stale tier (e.g. right after a cancellation)
  // until the fetch below resolves and corrects it — same-tab correction
  // happens within one refresh, so the window is small.
  const cached = readCachedStatus(requestedUserId);
  if (cached) {
    subscriptionState = cached;
    isKnown = true;
  } else {
    // Unknown until the fetch confirms free/pro, so subscribe buttons never
    // flash for a user who is actually Pro.
    isKnown = false;
  }

  try {
    const result = await fetchSubscriptionStatus(requestedUserId, accessToken);
    stale = auth.user?.id !== requestedUserId;
    if (!stale) {
      subscriptionState = result ?? FREE_SUBSCRIPTION;
      isKnown = result !== null;
      if (result) {
        writeCachedStatus(requestedUserId, result);
      }
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

  // Returns whether checkout actually opened, so callers (e.g. the pricing
  // dialog) know whether it's safe to close — closing on a no-op would lose
  // the user's plan selection and retry action.
  async openCheckout(plan: SubscriptionPlan): Promise<boolean> {
    // Only allow checkout once free status is confirmed, and never twice at once.
    if (checkoutInFlight || !isKnown || subscriptionState.tier !== 'free') {
      return false;
    }

    const accessToken = auth.state.session?.access_token;
    if (!accessToken) {
      return false;
    }

    checkoutInFlight = true;
    try {
      const checkoutUrl = await createCheckoutSession(accessToken, plan);
      if (!checkoutUrl) {
        return false;
      }
      await openCheckoutUrl(checkoutUrl);
      return true;
    } finally {
      checkoutInFlight = false;
    }
  },
};