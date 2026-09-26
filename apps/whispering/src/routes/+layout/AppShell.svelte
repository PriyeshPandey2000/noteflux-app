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
			// Surface it — until now, a revoked permission was only ever
			// console.warn'd, so a real user's Fn key would just silently
			// stop working with zero explanation. Persists (doesn't
			// auto-dismiss) since walking away from a silent Fn failure is
			// exactly the confusing case this exists to prevent. Tracks its
			// own toast ID so the warning can be dismissed once permission
			// is actually restored — without this it stayed on screen
			// forever even after re-granting, since restoring only ever
			// reinitialized the Fn manager, nothing dismissed the toast.
			let revokedWarningToastId: string | undefined;
			services.permissionMonitor.onRevoked(async () => {
				const { data } = await rpc.notify.warning.execute({
					title: '⌨️ Fn shortcut stopped working',
					description:
						"Accessibility permission was turned off. Re-enable it in Settings — if toggling it doesn't work, remove NoteFlux from the list and add it back.",
					persist: true,
					action: {
						type: 'button',
						label: 'Open Settings',
						onClick: () => {
							import('@tauri-apps/api/core').then(({ invoke }) =>
								invoke('open_apple_accessibility'),
							);
						},
					},
				});
				revokedWarningToastId = data ?? undefined;
			});
			services.permissionMonitor.onRestored(() => {
				if (revokedWarningToastId) {
					rpc.notify.dismiss(revokedWarningToastId);
					revokedWarningToastId = undefined;
				}
			});
			// Clicking the close button used to quit the whole app; now it
			// just hides the window (see lib.rs CloseRequested handler) so
			// the Fn shortcut keeps working. First time this happens, tell
			// the user why the app didn't actually go away — but the event
			// fires right after the window is hidden, so a toast rendered
			// immediately shows inside a webview nobody can see and expires
			// unseen. Defer it: mark a pending flag, only show (and only
			// then persist the "seen" setting) once the window is visible
			// again, via the tray's own show/hide toggle or Reopen.
			let closeNoticePending = false;
			const { listen } = await import('@tauri-apps/api/event');
			await listen('main-window-hidden-via-close-button', () => {
				if (settings.value['app.closeHidesToTrayNoticeShown']) return;
				closeNoticePending = true;
			});
			const currentWindow = (await import('@tauri-apps/api/window')).getCurrentWindow();
			await currentWindow.onFocusChanged(({ payload: isFocused }) => {
				if (!isFocused || !closeNoticePending) return;
				closeNoticePending = false;
				settings.updateKey('app.closeHidesToTrayNoticeShown', true);
				rpc.notify.info.execute({
					title: '👋 Still here',
					description:
						'NoteFlux keeps running in your menu bar so Fn still works. Quit from the menu bar icon to fully exit.',
				});
			});
			// Sign-up/sign-in finishing in the browser hands back a real
			// session via a noteflux://auth/callback deep link — this used
			// to fail completely silently (no toast, nothing), so someone
			// who completed signup would just see the app still showing
			// "Free plan" with zero explanation why. See auth-service.ts.
			window.addEventListener('noteflux-auth-callback-success', () => {
				rpc.notify.success.execute({
					title: '✅ Signed in',
					description: 'Your account is ready.',
				});
			});
			window.addEventListener('noteflux-auth-callback-error', ((
				event: CustomEvent<{ message: string }>,
			) => {
				rpc.notify.error.execute({
					title: '⚠️ Sign-in failed',
					description: `${event.detail.message} — try signing up again.`,
				});
			}) as EventListener);
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
