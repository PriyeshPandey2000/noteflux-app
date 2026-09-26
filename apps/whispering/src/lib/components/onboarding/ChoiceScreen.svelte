<script lang="ts">
	import { onMount } from 'svelte';
	import OnboardingButton from './OnboardingButton.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { supabase } from '$lib/services/auth/supabase-client';
	import CheckIcon from '@lucide/svelte/icons/check';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { celebrate } from './celebrate';

	type Props = {
		onNext: () => void;
		eyebrow?: string;
		headline?: string;
	};

	let {
		onNext,
		eyebrow = 'You just used Pro',
		headline = 'Keep the magic?',
	}: Props = $props();

	const PRO_FEATURES = [
		'Cloud transcription — faster, sharper',
		'Edit any text by voice',
		'Auto-cleanup of every dictation',
		'Local models free forever',
	];

	let isWaitingForSignup = $state(false);

	// Only one real path forward here, not two — every real signup gets the
	// same trial_ends_at = now() + 7 days DB default regardless of intent
	// (verified against the live database). A "Start Pro trial" button next
	// to a "Stay on Free" button that both call the exact same signUp() and
	// produce the exact same account would be showing a choice that isn't
	// real. See docs/specs/20260925T113952-anonymous-14-day-trial.md.
	function handleSignUp() {
		isWaitingForSignup = true;
		// Opens the website's sign-up page. Anonymous session tokens are
		// passed along so the website converts this session instead of
		// creating a second, disconnected account. Does NOT complete
		// onboarding here — auth.signUp() only opens a browser tab, it
		// doesn't confirm anything. Completing immediately meant onboarding
		// marked itself done even if the browser signup failed or was
		// abandoned, silently leaving the user anonymous despite there being
		// no other way out of onboarding by design. Completion now happens
		// below, only once the deep-link callback confirms a real session.
		auth.signUp().catch((error) => {
			console.error('Failed to open sign up:', error);
			isWaitingForSignup = false;
		});
	}

	onMount(() => {
		// Re-fetch directly rather than trusting the auth store's reactive
		// snapshot at this exact tick — setSession() inside the callback
		// handler and this event firing are close enough together that
		// relying on store timing would be fragile.
		const handleSuccess = async () => {
			const {
				data: { user },
			} = await supabase.auth.getUser();
			if (user && !user.is_anonymous) {
				celebrate({ particleCount: 160, originY: 0.5 });
				onNext();
				return;
			}
			// Callback fired but the session still isn't a real account —
			// shouldn't normally happen, but don't complete onboarding on it.
			isWaitingForSignup = false;
		};
		const handleError = () => {
			isWaitingForSignup = false;
		};
		window.addEventListener('noteflux-auth-callback-success', handleSuccess);
		window.addEventListener('noteflux-auth-callback-error', handleError);
		return () => {
			window.removeEventListener('noteflux-auth-callback-success', handleSuccess);
			window.removeEventListener('noteflux-auth-callback-error', handleError);
		};
	});
</script>

<div class="flex flex-col px-8 pt-7 pb-8 space-y-5">
	<div class="text-center space-y-1.5">
		<p class="text-[11px] uppercase tracking-[0.18em] text-green-300/70 font-medium">
			{eyebrow}
		</p>
		<h2 class="text-2xl font-semibold tracking-tight text-white">{headline}</h2>
		<p class="text-sm text-white/50">Create your free account to keep going.</p>
	</div>

	<!-- Pro card with animated glowing border -->
	<div class="pro-card relative rounded-2xl p-[1.5px]">
		<div class="relative rounded-[14px] bg-zinc-950/95 p-4 space-y-3.5">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<SparklesIcon class="w-4 h-4 text-green-300" />
					<span class="font-semibold text-white">Included free for 7 days</span>
				</div>
			</div>
			<ul class="space-y-2">
				{#each PRO_FEATURES as feature (feature)}
					<li class="flex items-center gap-2 text-sm text-white/80">
						<span
							class="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center shrink-0"
						>
							<CheckIcon class="w-2.5 h-2.5 text-green-300" />
						</span>
						{feature}
					</li>
				{/each}
			</ul>
			<OnboardingButton onclick={handleSignUp} class="w-full h-11 text-base cursor-pointer">
				{isWaitingForSignup ? 'Waiting for you in the browser…' : 'Sign up free — 7 days of Pro →'}
			</OnboardingButton>
			{#if isWaitingForSignup}
				<p class="text-center text-[11px] text-white/35">
					Didn't open? Click again to retry.
				</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.pro-card {
		background: conic-gradient(
			from var(--angle),
			rgba(74, 222, 128, 0.15),
			#4ade80,
			#a7f3d0,
			rgba(74, 222, 128, 0.15) 40%,
			rgba(74, 222, 128, 0.15)
		);
		animation: spin 4s linear infinite;
		box-shadow: 0 0 40px rgba(74, 222, 128, 0.15);
	}

	@property --angle {
		syntax: '<angle>';
		initial-value: 0deg;
		inherits: false;
	}

	@keyframes spin {
		to {
			--angle: 360deg;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pro-card {
			animation: none;
		}
	}
</style>
