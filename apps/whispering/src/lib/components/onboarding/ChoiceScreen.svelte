<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/ui/button';
	import { auth } from '$lib/stores/auth.svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CloudIcon from '@lucide/svelte/icons/cloud';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { celebrate } from './celebrate';

	type Props = {
		onNext: () => void;
	};

	let { onNext }: Props = $props();

	const PRO_FEATURES = [
		'Cloud transcription — faster, sharper',
		'Edit any text by voice',
		'Auto-cleanup of every dictation',
	];

	function handleStartTrial() {
		celebrate({ particleCount: 160, originY: 0.5 });
		// Opens the website's sign-up page; the 7-day trial is granted by
		// the `trial_ends_at` column default on real signup (verified against
		// the live database — see
		// docs/specs/20260923T170151-onboarding-pro-demo-redesign.md). Anonymous
		// session tokens are passed along so the website converts this session
		// instead of creating a second, disconnected account.
		auth.signUp().catch((error) => {
			console.error('Failed to open sign up:', error);
		});
		onNext();
	}

	function handleUseFree() {
		onNext();
		// Local transcription needs a model downloaded first — nothing is
		// bundled with the install. Send them to the existing model picker.
		goto('/settings/transcription');
	}
</script>

<div class="flex flex-col px-8 pt-7 pb-8 space-y-5">
	<div class="text-center space-y-1.5">
		<p class="text-[11px] uppercase tracking-[0.18em] text-green-300/70 font-medium">
			You just used Pro
		</p>
		<h2 class="text-2xl font-semibold tracking-tight text-white">Keep the magic?</h2>
		<p class="text-sm text-white/50">7 days free. No card, nothing to cancel.</p>
	</div>

	<!-- Pro card with animated glowing border -->
	<div class="pro-card relative rounded-2xl p-[1.5px]">
		<div class="relative rounded-[14px] bg-zinc-950/95 p-4 space-y-3.5">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<SparklesIcon class="w-4 h-4 text-green-300" />
					<span class="font-semibold text-white">Pro</span>
				</div>
				<span
					class="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-500/15 text-green-300 border border-green-500/25"
				>
					Recommended
				</span>
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
			<Button onclick={handleStartTrial} class="w-full h-11 text-base font-medium cursor-pointer">
				Start 7-day free trial
			</Button>
		</div>
	</div>

	<!-- Free option -->
	<button
		onclick={handleUseFree}
		class="group flex items-center gap-3 w-full rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.05] px-4 py-3 text-left transition-colors cursor-pointer"
	>
		<div class="w-9 h-9 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
			<HardDriveIcon class="w-4 h-4 text-white/60" />
		</div>
		<div class="flex-1 min-w-0">
			<p class="text-sm font-medium text-white/80">Stay on Free</p>
			<p class="text-xs text-white/40">Unlimited offline transcription, on your Mac</p>
		</div>
		<span class="text-white/30 group-hover:text-white/60 group-hover:translate-x-0.5 transition-all">
			→
		</span>
	</button>

	<p class="flex items-center justify-center gap-1.5 text-[11px] text-white/30">
		<CloudIcon class="w-3 h-3" />
		Upgrade or switch anytime from the sidebar
	</p>
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
