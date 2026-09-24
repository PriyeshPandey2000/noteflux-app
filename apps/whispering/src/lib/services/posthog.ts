import posthog from 'posthog-js';
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';

/**
 * PostHog analytics service for tracking user journeys and funnels.
 *
 * Session Recording: ENABLED
 * - Records user screen/interactions during onboarding to identify failure points
 * - Masks all input fields to protect sensitive data (API keys, passwords, etc.)
 * - Use PostHog dashboard to watch session replays and see where users struggle
 *
 * Events Tracked:
 * - Onboarding flow: started, steps completed, skipped, completed (with user email)
 * - App lifecycle: first session, app start, user returned
 * - Recording funnel: recording started, recording completed (manual/vad)
 * - Transcription funnel: transcription started, transcription completed (with duration)
 * - Text delivery: text delivered to clipboard/cursor
 */

// Platform information for tagging events
const platformInfo = {
	platform: 'desktop',
	os: browser && typeof window !== 'undefined' ?
		(navigator.userAgent.includes('Mac') ? 'mac' :
		 navigator.userAgent.includes('Win') ? 'windows' :
		 navigator.userAgent.includes('Linux') ? 'linux' : 'other') : 'unknown',
	app: 'whispering',
	arch: browser && typeof window !== 'undefined' ?
		(navigator.userAgent.includes('arm') || navigator.userAgent.includes('ARM') ? 'arm64' : 'x64') : 'unknown'
};

export const analytics = {
	init() {
		if (!browser) return;

		const apiKey = env.PUBLIC_POSTHOG_KEY;
		const host = env.PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';

		if (!apiKey) {
			console.warn('PostHog API key not found');
			return;
		}

		posthog.init(apiKey, {
			api_host: host,
			// Session recording enabled to see onboarding user behavior
			disable_session_recording: false,
			session_recording: {
				// Mask sensitive inputs
				maskAllInputs: true,
				maskTextSelector: '[data-private]',
			},
			disable_compression: false,
			// Capture settings
			capture_pageview: false, // Manual page view tracking
			capture_pageleave: false,
			// Person profiles
			person_profiles: 'always', // Track users for outreach
			// Other privacy settings
			respect_dnt: true,
			opt_out_capturing_by_default: false,
			debug: false,
			loaded: () => {}
		});
	},

	// Identify user for outreach (call when user logs in)
	async identifyUser() {
		if (!browser) return;
		try {
			const { supabase } = await import('$lib/services/auth/supabase-client');
			const { data: { user } } = await supabase.auth.getUser();

			if (user?.email) {
				posthog.identify(user.email, {
					email: user.email
				});
			}
		} catch (error) {
			// Silently fail if user not logged in
		}
	},

	// User journey funnel events
	trackAppStart() {
		if (!browser) return;
		posthog.capture('app_started_desktop', platformInfo);
	},

	trackFirstSession() {
		if (!browser) return;
		posthog.capture('first_session_desktop', platformInfo);
	},

	trackUserReturned(daysSinceLastVisit: number) {
		if (!browser) return;
		posthog.capture('user_returned', {
			days_since_last_visit: daysSinceLastVisit,
			...platformInfo
		});
	},

	// Onboarding tracking
	async trackOnboardingStarted() {
		if (!browser) return;

		try {
			const { supabase } = await import('$lib/services/auth/supabase-client');
			const { data: { user } } = await supabase.auth.getUser();

			posthog.capture('onboarding_started', {
				email: user?.email || 'anonymous',
				...platformInfo
			});
		} catch (error) {
			posthog.capture('onboarding_started', {
				email: 'anonymous',
				...platformInfo
			});
		}
	},

	async trackOnboardingStepCompleted(step: string) {
		if (!browser) return;

		try {
			const { supabase } = await import('$lib/services/auth/supabase-client');
			const { data: { user } } = await supabase.auth.getUser();

			posthog.capture('onboarding_step_completed', {
				step,
				email: user?.email || 'anonymous',
				...platformInfo
			});
		} catch (error) {
			posthog.capture('onboarding_step_completed', {
				step,
				email: 'anonymous',
				...platformInfo
			});
		}
	},

	async trackOnboardingCompleted() {
		if (!browser) return;

		try {
			const { supabase } = await import('$lib/services/auth/supabase-client');
			const { data: { user } } = await supabase.auth.getUser();

			posthog.capture('onboarding_completed', {
				email: user?.email || 'anonymous',
				...platformInfo
			});
		} catch (error) {
			posthog.capture('onboarding_completed', {
				email: 'anonymous',
				...platformInfo
			});
		}
	},

	// Feature usage tracking
	trackFeatureUsed(feature: string) {
		if (!browser) return;
		posthog.capture('feature_used', { feature, ...platformInfo });
	},

	trackPageVisit(page: string) {
		if (!browser) return;
		posthog.capture('page_visited', { page, ...platformInfo });
	},

	// Settings and preferences
	trackSettingsChanged(section: string) {
		if (!browser) return;
		posthog.capture('settings_changed', { section, ...platformInfo });
	},

	// Error tracking
	trackError(error: string, context?: string) {
		if (!browser) return;
		posthog.capture('error_occurred', {
			error_type: error,
			context,
			...platformInfo
		});
	},

	// Recording funnel events
	trackRecordingStarted(type: 'manual' | 'vad') {
		if (!browser) return;
		posthog.capture('recording_started_desktop', {
			recording_type: type,
			...platformInfo
		});
	},

	trackRecordingCompleted(type: 'manual' | 'vad') {
		if (!browser) return;
		posthog.capture('recording_completed_desktop', {
			recording_type: type,
			...platformInfo
		});
	},

	// Transcription funnel events
	trackTranscriptionStarted(provider: string) {
		if (!browser) return;
		posthog.capture('transcription_started', {
			provider,
			...platformInfo
		});
	},

	trackTranscriptionCompleted(provider: string, duration: number) {
		if (!browser) return;
		posthog.capture('transcription_completed', {
			provider,
			duration_ms: duration,
			...platformInfo
		});
	},

	// Text delivery events
	trackTextDelivered(method: 'clipboard' | 'cursor') {
		if (!browser) return;
		posthog.capture('text_delivered', {
			delivery_method: method,
			...platformInfo
		});
	}
};
