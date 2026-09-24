<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { rpc } from '$lib/query';
	import { settings } from '$lib/stores/settings.svelte';
	import { onboardingStore } from '$lib/stores/onboarding.svelte';
	import { initializationStore } from '$lib/stores/initialization.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { analytics } from '$lib/services/posthog';
	import { Button } from '$lib/ui/button';
	import * as Dialog from '$lib/ui/dialog';
	import { tryAsync } from 'wellcrafted/result';
	import { onMount, onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import WelcomeScreen from './WelcomeScreen.svelte';
	import PermissionsScreen from './PermissionsScreen.svelte';
	import UsageGuideScreen from './UsageGuideScreen.svelte';
	import InlineEditDemoScreen from './InlineEditDemoScreen.svelte';
	import ChoiceScreen from './ChoiceScreen.svelte';

	type OnboardingStep =
		| 'welcome'
		| 'permissions'
		| 'usage-guide'
		| 'inline-edit'
		| 'choice'
		| 'complete';

	const PROGRESS_STEPS: OnboardingStep[] = [
		'welcome',
		'permissions',
		'usage-guide',
		'inline-edit',
		'choice',
	];
	const progressIndex = $derived(PROGRESS_STEPS.indexOf(onboardingStore.currentStep));

	let permissionsComplete = $state(false);
	let hasProcessedReopen = $state(false);
	// Arms the mid-session recovery effect below only after confirming the
	// user actually reached the shortcuts settings page — otherwise it fires
	// during handleCustomizeShortcut's own ~150ms close-then-navigate delay,
	// when resumeStep is already set but the pathname hasn't changed yet,
	// reopening onboarding before the real navigation even happens.
	let hasReachedShortcutsPage = $state(false);

	const isDesktop = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

	/**
	 * Check if microphone permission is currently granted
	 */
	async function checkMicrophonePermission(): Promise<boolean> {
		// On desktop, use native macOS API to check actual system permissions
		if (isDesktop) {
			try {
				const { invoke } = await import('@tauri-apps/api/core');
				return await invoke<boolean>('is_macos_microphone_enabled');
			} catch {
				return false;
			}
		}

		// On web, use browser permissions API
		try {
			if ('permissions' in navigator) {
				const permissionStatus = await navigator.permissions.query({
					name: 'microphone' as PermissionName,
				});
				return permissionStatus.state === 'granted';
			}
			return false;
		} catch {
			return false;
		}
	}

	/**
	 * Check if accessibility permission is currently granted (desktop only)
	 */
	async function checkAccessibilityPermission(): Promise<boolean> {
		if (!isDesktop) return true;

		try {
			const { invoke } = await import('@tauri-apps/api/core');
			return await invoke<boolean>('is_macos_accessibility_enabled', {
				askIfNotAllowed: false,
			});
		} catch {
			return false;
		}
	}

	function nextStep() {
		switch (onboardingStore.currentStep) {
			case 'welcome':
				analytics.trackOnboardingStepCompleted('welcome');
				onboardingStore.currentStep = 'permissions';
				break;
			case 'permissions':
				if (permissionsComplete) {
					analytics.trackOnboardingStepCompleted('permissions');
					onboardingStore.currentStep = 'usage-guide';
				}
				break;
			case 'usage-guide':
				analytics.trackOnboardingStepCompleted('usage-guide');
				onboardingStore.currentStep = 'inline-edit';
				break;
			case 'inline-edit':
				analytics.trackOnboardingStepCompleted('inline-edit');
				onboardingStore.currentStep = 'choice';
				break;
			case 'choice':
				analytics.trackOnboardingStepCompleted('choice');
				onboardingStore.currentStep = 'complete';
				completeOnboarding();
				break;
		}
	}

	function completeOnboarding() {
		// Mark onboarding as complete
		settings.updateKey('app.onboardingCompleted', true);
		settings.updateKey('onboarding.resumeStep', null);
		onboardingStore.close();
		onboardingStore.currentStep = 'welcome'; // Reset for next time

		// Reset body styles that may have been set by dialog
		if (typeof document !== 'undefined') {
			document.body.style.overflow = '';
			document.body.style.pointerEvents = '';
		}

		// Anonymous session already created at onboarding start
		// No need to create it again here

		// Track completion
		analytics.trackOnboardingCompleted();
		rpc.analytics.logEvent.execute({
			type: 'onboarding_completed'
		});
	}

	function handlePermissionsComplete(complete: boolean) {
		permissionsComplete = complete;
		if (complete) {
			// Auto-advance after a short delay to show success state
			setTimeout(() => {
				nextStep();
			}, 1000);
		}
	}

	// Check if onboarding should be shown
	onMount(async () => {
		const isCompleted = settings.value['app.onboardingCompleted'];

		// Check actual system permission state (source of truth)
		// On desktop, uses native macOS APIs to check real system permissions
		// On web, uses browser permissions API
		const hasMicPermission = await checkMicrophonePermission();
		const hasAccessibilityPermission = await checkAccessibilityPermission();
		const allPermissionsGranted = hasMicPermission && hasAccessibilityPermission;

		// console.log('Onboarding check:', {
		// 	isCompleted,
		// 	hasMicPermission,
		// 	hasAccessibilityPermission,
		// 	allPermissionsGranted
		// });

		// Force onboarding for development/fresh builds (uncomment for testing)
		// settings.updateKey('app.onboardingCompleted', false);

		// Show onboarding if:
		// 1. User has never completed onboarding, OR
		// 2. Permissions are missing (handles fresh installs, bundle ID migrations, etc.)
		if (!isCompleted || !allPermissionsGranted) {
			// Create anonymous session BEFORE showing onboarding
			// This allows users to test features (recording, paste) during onboarding
			if (!auth.isAuthenticated) {
				try {
					await auth.signInAnonymously();
				} catch (error) {
					console.error('Failed to create anonymous session:', error);
				}
			}

			onboardingStore.isOpen = true;

			// If onboarding was marked complete but permissions are missing,
			// skip directly to permissions screen (e.g., after bundle ID change or uninstall/reinstall)
			if (isCompleted && !allPermissionsGranted) {
				onboardingStore.currentStep = 'permissions';
			} else if (!isCompleted) {
				// Resume where they left off if they bailed via the
				// "Customize Shortcut" detour (see UsageGuideScreen.svelte).
				// The reopenOnboarding query param is a more specific, more
				// recent signal (the shortcut-recorder dialog just closed),
				// so it takes priority when both are present — its own
				// $effect further down handles that case.
				const hasReopenParam = $page.url.searchParams.has('reopenOnboarding');
				const resumeStep = settings.value['onboarding.resumeStep'];
				if (!hasReopenParam && resumeStep) {
					// Permissions were granted back when they first reached
					// this step (permissions comes before usage-guide) — but
					// they could've been revoked since. Route to permissions
					// first rather than resuming straight into a demo that'd
					// silently fail; normal step progression carries them
					// back to usage-guide afterward.
					onboardingStore.currentStep = allPermissionsGranted
						? resumeStep
						: 'permissions';
				}
				// One-shot: consumed or not, don't let a stale resume step
				// keep overriding normal step progression later.
				if (resumeStep) {
					settings.updateKey('onboarding.resumeStep', null);
				}
			}

			// Track onboarding started
			analytics.trackOnboardingStarted();
		}

		// Signal that initialization checks are complete
		initializationStore.complete();
	});

	// Force hide recording overlay when component is destroyed
	onDestroy(async () => {
		// Reset body styles that may have been set by dialog
		if (typeof document !== 'undefined') {
			document.body.style.overflow = '';
			document.body.style.pointerEvents = '';
		}

		if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
			try {
				const { invoke } = await import('@tauri-apps/api/core');
				await invoke('hide_recording_overlay');
			} catch (error) {
				// Silently fail if overlay is not visible
			}
		}
	});

	// Reset body styles when dialog closes
	$effect(() => {
		if (!onboardingStore.isOpen && typeof document !== 'undefined') {
			// Dialog is closed, ensure body styles are reset
			document.body.style.overflow = '';
			document.body.style.pointerEvents = '';
		}
	});

	// Force dark mode during onboarding for consistent appearance
	$effect(() => {
		if (typeof document === 'undefined') return;

		const html = document.documentElement;

		if (onboardingStore.isOpen) {
			// Store the original class to restore later
			const originalClass = html.className;
			html.setAttribute('data-original-class', originalClass);

			// Force dark mode
			if (!html.classList.contains('dark')) {
				html.classList.add('dark');
			}
		} else {
			// Restore original class when onboarding closes
			const originalClass = html.getAttribute('data-original-class');
			if (originalClass !== null) {
				html.className = originalClass;
				html.removeAttribute('data-original-class');
			}
		}
	});

	// Check for query param to reopen onboarding after shortcut configuration
	$effect(() => {
		const reopenStep = $page.url.searchParams.get('reopenOnboarding') as OnboardingStep | null;

		if (reopenStep && !hasProcessedReopen) {
			hasProcessedReopen = true;

			// Reset paste test when returning to usage guide after shortcut customization
			if (reopenStep === 'usage-guide') {
				settings.updateKey('onboarding.pasteTestCompleted', false);
			}

			// Clean up the URL
			const newUrl = new URL(window.location.href);
			newUrl.searchParams.delete('reopenOnboarding');
			window.history.replaceState({}, '', newUrl.pathname + newUrl.search);

			// Open the dialog
			onboardingStore.openAt(reopenStep);
		}

		// Reset the flag when there's no query param (so it can process again next time)
		if (!reopenStep && hasProcessedReopen) {
			hasProcessedReopen = false;
		}
	});

	// Mid-session recovery: if they left the "Customize Shortcut" detour by
	// navigating away instead of finishing the shortcut-recorder dialog (the
	// only path the effect above catches), reopen onboarding as soon as they
	// land anywhere outside the shortcuts settings page — same session, no
	// need to wait for the next app relaunch. Same reopen behavior as the
	// success path above, just triggered by a wider set of exits. Skips the
	// permissions re-check that onMount does (cross-restart only) — the gap
	// here is seconds, not enough time for permissions to realistically
	// change.
	$effect(() => {
		const resumeStep = settings.value['onboarding.resumeStep'];
		const isCompleted = settings.value['app.onboardingCompleted'];
		const onShortcutsPage = $page.url.pathname.startsWith('/settings/shortcuts');
		const hasReopenParam = $page.url.searchParams.has('reopenOnboarding');

		if (onShortcutsPage) {
			hasReachedShortcutsPage = true;
		}

		if (
			resumeStep &&
			!isCompleted &&
			!onboardingStore.isOpen &&
			!onShortcutsPage &&
			!hasReopenParam &&
			hasReachedShortcutsPage
		) {
			hasReachedShortcutsPage = false;
			settings.updateKey('onboarding.resumeStep', null);
			onboardingStore.openAt(resumeStep);
		}
	});

	// Debug functions - expose to window for manual testing
	if (typeof window !== 'undefined') {
		(window as any).showOnboarding = (step?: OnboardingStep) => {
			onboardingStore.currentStep = step || 'welcome';
			permissionsComplete = false; // Reset to prevent auto-advance
			onboardingStore.isOpen = true;
		};

		(window as any).resetOnboarding = () => {
			settings.updateKey('app.onboardingCompleted', false);
			settings.updateKey('onboarding.pasteTestCompleted', false);
			settings.updateKey('onboarding.resumeStep', null);
			onboardingStore.currentStep = 'welcome';
			permissionsComplete = false;
			console.log('✅ Onboarding reset! Refresh the page to see the automatic onboarding flow.');
		};
	}
</script>

<Dialog.Root bind:open={onboardingStore.isOpen}>
	<Dialog.Content
		class="max-w-md border border-white/10 bg-zinc-900/80 backdrop-blur-2xl shadow-[0px_40px_80px_rgba(0,0,0,0.6)] rounded-2xl !z-[9999]"
		showCloseButton={false}
		overlayClass="bg-black/40 backdrop-blur-xl !z-[9998]"
		onInteractOutside={(e) => {
			// Prevent closing during permissions and usage-guide steps
			if (onboardingStore.currentStep !== 'welcome') {
				e.preventDefault();
			}
		}}
		onEscapeKeydown={(e) => {
			// Prevent closing during permissions and usage-guide steps
			if (onboardingStore.currentStep !== 'welcome') {
				e.preventDefault();
			}
		}}
	>
		<div class="relative overflow-hidden rounded-2xl">
			<!-- Ambient glow behind every step -->
			<div
				class="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-80 h-64 rounded-full bg-green-500/15 blur-3xl"
			></div>

			<!-- Progress rail -->
			<div class="relative flex items-center gap-1.5 px-8 pt-6">
				{#each PROGRESS_STEPS as step, i (step)}
					<div class="h-1 flex-1 rounded-full bg-white/[0.08] overflow-hidden">
						<div
							class="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-300 transition-all duration-500 ease-out"
							style="width: {i <= progressIndex ? '100%' : '0%'}"
						></div>
					</div>
				{/each}
			</div>

			{#key onboardingStore.currentStep}
			<div class="relative" in:fly={{ y: 12, duration: 380 }}>
			{#if onboardingStore.currentStep === 'welcome'}
				<WelcomeScreen onNext={nextStep} />
			{:else if onboardingStore.currentStep === 'permissions'}
				<PermissionsScreen
					onNext={nextStep}
					onComplete={handlePermissionsComplete}
				/>
			{:else if onboardingStore.currentStep === 'usage-guide'}
				<UsageGuideScreen onNext={nextStep} />
			{:else if onboardingStore.currentStep === 'inline-edit'}
				<InlineEditDemoScreen onNext={nextStep} />
			{:else if onboardingStore.currentStep === 'choice'}
				<ChoiceScreen onNext={nextStep} />
			{/if}
			</div>
			{/key}
		</div>
	</Dialog.Content>
</Dialog.Root>