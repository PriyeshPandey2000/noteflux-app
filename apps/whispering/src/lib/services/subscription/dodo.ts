export type SubscriptionTier = 'free' | 'pro';
export type SubscriptionPlan = 'monthly' | 'yearly';

export type SubscriptionStatus = {
  tier: SubscriptionTier;
  isActive: boolean;
  subscriptionId: string | null;
  currentPeriodEnd: string | null;
};

const NOTEFLUX_API_URL = 'https://noteflux.app';

export async function fetchSubscriptionStatus(
  userId: string,
  accessToken: string
): Promise<SubscriptionStatus> {
  try {
    const response = await fetch(
      `${NOTEFLUX_API_URL}/api/subscription?user_id=${encodeURIComponent(userId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      return { tier: 'free', isActive: false, subscriptionId: null, currentPeriodEnd: null };
    }

    const data = await response.json();

    return {
      tier: data.tier === 'pro' ? 'pro' : 'free',
      isActive: data.isActive === true,
      subscriptionId: data.subscriptionId || null,
      currentPeriodEnd: data.currentPeriodEnd || null,
    };
  } catch (error) {
    console.error('Failed to check subscription status:', error);
    return { tier: 'free', isActive: false, subscriptionId: null, currentPeriodEnd: null };
  }
}

export async function createCheckoutSession(
  accessToken: string,
  plan: SubscriptionPlan
): Promise<string | null> {
  try {
    const response = await fetch(`${NOTEFLUX_API_URL}/api/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ plan }),
    });

    if (!response.ok) {
      console.error('Checkout request failed:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    return typeof data.checkoutUrl === 'string' ? data.checkoutUrl : null;
  } catch (error) {
    console.error('Failed to create checkout session:', error);
    return null;
  }
}

export async function openCheckoutUrl(checkoutUrl: string): Promise<void> {
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