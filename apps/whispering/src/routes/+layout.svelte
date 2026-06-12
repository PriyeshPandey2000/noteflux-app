<script lang="ts">
	import { onNavigate } from '$app/navigation';
	import { rpc } from '$lib/query';
	import { queryClient } from '$lib/query/_client';
	import * as services from '$lib/services';
	import { analytics } from '$lib/services/posthog';
	import { QueryClientProvider } from '@tanstack/svelte-query';
	import '$lib/ui/app.css';
	// import { SvelteQueryDevtools } from '@tanstack/svelte-query-devtools';

	import AppShell from './+layout/AppShell.svelte';
	import SignupRequiredDialog from '$lib/components/auth/SignupRequiredDialog.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { QWEN3_ASR_SUPPORTED_LANGUAGES } from '$lib/constants/languages';

	let { children } = $props();

	// Warm up daemon on Qwen3ASR select; kill it when switching away to free RAM.
	// Also resets output language to 'auto' if the current language isn't supported
	// by Qwen3ASR — prevents blank/invalid selection in the language dropdown.
	$effect(() => {
		if (settings.value['transcription.selectedTranscriptionService'] === 'Qwen3ASR') {
			const lang = settings.value['transcription.outputLanguage'];
			if (!(QWEN3_ASR_SUPPORTED_LANGUAGES as readonly string[]).includes(lang)) {
				settings.updateKey('transcription.outputLanguage', 'auto');
			}
			services.transcriptions.qwen3asr.preload(
				settings.value['transcription.qwen3asr.modelId'] as import('$lib/services/transcription/qwen3-asr').Qwen3ASRModelId,
			);
		} else {
			services.transcriptions.qwen3asr.shutdown();
		}
	});

	onNavigate((navigation) => {
		if (!document.startViewTransition) return;

		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	// Commenting out local shortcuts - keeping global shortcuts only
	// $effect(() => {
	// 	const unlisten = services.localShortcutManager.listen();
	// 	return () => unlisten();
	// });

	// Initialize PostHog and track app start
	$effect(() => {
		analytics.init();

		// Identify user for outreach purposes
		analytics.identifyUser();

		// Track app start immediately
		analytics.trackAppStart();
		rpc.analytics.logEvent.execute({ type: 'app_started' });

		// Simple first session tracking
		const lastVisit = localStorage.getItem('lastVisit');
		const now = Date.now();

		if (!lastVisit) {
			// First time opening the app (includes reinstalls: they need onboarding too!)
			analytics.trackFirstSession();
		} else {
			// Returning user: calculate days since last visit
			const daysSince = Math.floor((now - parseInt(lastVisit)) / (1000 * 60 * 60 * 24));
			if (daysSince > 0) {
				analytics.trackUserReturned(daysSince);
			}
		}

		// Update last visit time
		localStorage.setItem('lastVisit', now.toString());
	});
</script>

<svelte:head>
	<title>NoteFlux</title>
</svelte:head>

<QueryClientProvider client={queryClient}>
	<AppShell>
		{@render children()}
	</AppShell>
	<SignupRequiredDialog />
</QueryClientProvider>

<!-- <SvelteQueryDevtools client={queryClient} buttonPosition="bottom-left" /> -->