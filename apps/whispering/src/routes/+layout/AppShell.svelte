<script lang="ts">
	import { goto } from '$app/navigation';
	import { commandCallbacks } from '$lib/commands';
	import ConfirmationDialog from '$lib/components/ConfirmationDialog.svelte';
	import MoreDetailsDialog from '$lib/components/MoreDetailsDialog.svelte';
	// import NotificationLog from '$lib/components/NotificationLog.svelte';
	import UpdateDialog from '$lib/components/UpdateDialog.svelte';
	import UsageLimitDialog from '$lib/components/UsageLimitDialog.svelte';
	import { usageLimitDialog } from '$lib/stores/usage-limit-dialog.svelte';
	import AuthRequiredDialog from '$lib/components/AuthRequiredDialog.svelte';
	import OnboardingFlow from '$lib/components/onboarding/OnboardingFlow.svelte';
	import { rpc } from '$lib/query';
	import * as services from '$lib/services';
	import { settings } from '$lib/stores/settings.svelte';
	// import { extension } from '@repo/extension';
	import { createQuery } from '@tanstack/svelte-query';
	import { Toaster, type ToasterProps } from 'svelte-sonner';
	import { onMount } from 'svelte';
	import { AudioLines } from '@lucide/svelte';
	import { mode, ModeWatcher } from 'mode-watcher';

	import { syncWindowAlwaysOnTopWithRecorderState } from './alwaysOnTop.svelte';
	import { checkForUpdates } from './check-for-updates';
	import {
		resetGlobalShortcutsToDefaultIfDuplicates,
		syncGlobalShortcutsWithSettings,
	} from './register-commands';
	import { registerOnboarding } from './register-onboarding';

	import Sidebar from '$lib/components/Sidebar.svelte';
	import NavItems from '$lib/components/NavItems.svelte';

	const getRecorderStateQuery = createQuery(
		rpc.recorder.getRecorderState.options,
	);
	const getVadStateQuery = createQuery(rpc.vadRecorder.getVadState.options);

	onMount(async () => {
		// Validate and clear stale auth state on startup
		try {
			const { supabase } = await import('$lib/services/auth/supabase-client');
			const { data: { session } } = await supabase.auth.getSession();
			
			if (session) {
				// Check if session is expired
				const expiresAt = session.expires_at;
				const now = Math.floor(Date.now() / 1000);
				
				if (expiresAt && expiresAt < now) {
					console.log('[Startup] Session expired, clearing stale auth state');
					await supabase.auth.signOut();
				}
			}
		} catch (error) {
			console.error('[Startup] Failed to validate auth state:', error);
		}

		window.commands = commandCallbacks;
		window.goto = goto;
		// Commenting out local shortcuts - using global shortcuts only
		// syncLocalShortcutsWithSettings();
		// resetLocalShortcutsToDefaultIfDuplicates();
		if (window.__TAURI_INTERNALS__) {
			syncGlobalShortcutsWithSettings();
			resetGlobalShortcutsToDefaultIfDuplicates();
			await checkForUpdates();
			// Start global permission monitoring for Fn key functionality
			await services.permissionMonitor.start();
		} else {
			// const _notifyNoteFluxTabReadyResult =
			// await extension.notifyNoteFluxTabReady(undefined);
		}
		registerOnboarding();
	});

	if (window.__TAURI_INTERNALS__) {
		syncWindowAlwaysOnTopWithRecorderState();
	}

	$effect(() => {
		getRecorderStateQuery.data;
		getVadStateQuery.data;
		services.db.cleanupExpiredRecordings({
			maxRecordingCount: settings.value['database.maxRecordingCount'],
			recordingRetentionStrategy:
				settings.value['database.recordingRetentionStrategy'],
		});
	});

	const TOASTER_SETTINGS = {
		closeButton: true,
		duration: 5000,
		position: 'bottom-right',
		richColors: true,
		toastOptions: {
			classes: {
				actionButton: 'w-full mt-3 inline-flex justify-center',
				closeButton: 'w-full mt-3 inline-flex justify-center',
				icon: 'shrink-0',
				toast: 'flex flex-wrap *:data-content:flex-1',
			},
		},
		visibleToasts: 5,
	} satisfies ToasterProps;

	let { children } = $props();
</script>

<button
	class="xxs:hidden hover:bg-accent hover:text-accent-foreground h-screen w-screen transform duration-300 ease-in-out"
	onclick={commandCallbacks.toggleManualRecording}
	aria-label={getRecorderStateQuery.data === 'RECORDING' ? 'Stop recording' : 'Start recording'}
	title={getRecorderStateQuery.data === 'RECORDING' ? 'Stop recording' : 'Start recording'}
>
	<span
		style="filter: drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.5));"
		class="text-[48px] leading-none"
	>
		{#if getRecorderStateQuery.data === 'RECORDING'}
			⏹️
		{:else}
			<AudioLines class="size-12" />
		{/if}
	</span>
</button>

<div class="xxs:flex hidden h-screen w-full overflow-hidden bg-[#fdfbff] dark:bg-[#1c1917]">
	<!-- Desktop Sidebar -->
	<Sidebar class="hidden md:flex" />

	<!-- Main Content Area -->
	<div class="flex-1 flex flex-col h-full overflow-hidden relative min-w-0">
		<main class="flex-1 overflow-y-auto w-full">
			<div class="flex flex-col items-center gap-2 p-4 min-h-full w-full mx-auto">
				{@render children()}
			</div>
		</main>

		<!-- Mobile Bottom Navigation -->
		<div class="md:hidden border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shrink-0 z-50">
			<div class="flex h-14 items-center justify-center px-4">
				<NavItems />
			</div>
		</div>
	</div>
</div>

<Toaster
	offset={16}
	class="xs:block hidden"
	theme={mode.current}
	{...TOASTER_SETTINGS}
/>
<ModeWatcher />
<ConfirmationDialog />
<MoreDetailsDialog />
<!-- <NotificationLog /> -->
<UpdateDialog />
<UsageLimitDialog 
	bind:open={usageLimitDialog.isOpen}
	totalMinutes={usageLimitDialog.totalMinutes}
	limitMinutes={usageLimitDialog.limitMinutes}
/>
<AuthRequiredDialog />
<OnboardingFlow />

<style>
   :global(body) {
      min-height: 100vh;
      display: grid;
      grid-template-rows: 1fr auto;
   }
</style>
