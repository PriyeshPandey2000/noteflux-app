<script lang="ts">
	import { Button } from '$lib/ui/button';
	import { settings } from '$lib/stores/settings.svelte';
	import { onboardingStore } from '$lib/stores/onboarding.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import { createQuery } from '@tanstack/svelte-query';
	import { rpc } from '$lib/query';
	import { celebrate } from './celebrate';
	import Keycap from './Keycap.svelte';
	import VoiceRing from './VoiceRing.svelte';

	type Props = {
		onNext: () => void;
	};

	let { onNext }: Props = $props();

	const isDesktop = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

	// Get the active shortcut based on recording mode
	const recordingMode = $derived(settings.value['shortcuts.recordingMode']);
	const shortcut = $derived(
		recordingMode === 'hold'
			? (settings.value['shortcuts.global.pushToTalk'] || 'Fn')
			: (settings.value['shortcuts.global.toggleManualRecording'] || 'Option+Space')
	);

	const shortcutKeys = $derived(shortcut.split('+').map((key) => key.trim()));

	// Text editor state
	let editorContent = $state('');
	let hasTried = $derived(editorContent.trim().length > 0);
	let textareaRef = $state<HTMLTextAreaElement | null>(null);
	let hasShownConfetti = $state(false);

	// Auto-focus textarea on mount and after dialog reopens
	onMount(async () => {
		// Focus textarea with multiple attempts to ensure it works
		const focusTextarea = () => {
			if (textareaRef) {
				textareaRef.focus();
			}
		};

		// Proactively bring the window to the front on mount — the
		// permissions step right before this one routes through macOS
		// permission prompts / System Settings, which can leave this window
		// in the background with no natural 'focus' event to react to.
		// Without this, the first click on anything here (e.g. "Customize
		// Shortcut") just re-activates the window instead of registering,
		// requiring a second click. PermissionsScreen.svelte already does
		// this proactively for the same reason.
		if (isDesktop && window.__TAURI_INTERNALS__) {
			try {
				const { getCurrentWindow } = await import('@tauri-apps/api/window');
				const currentWindow = getCurrentWindow();
				await currentWindow.show();
				await currentWindow.unminimize();
				await currentWindow.setFocus();
			} catch (e) {
				console.log('Could not proactively focus window:', e);
			}
		}

		// Try multiple times with increasing delays
		setTimeout(focusTextarea, 50);
		setTimeout(focusTextarea, 150);
		setTimeout(focusTextarea, 300);

		// Ensure window stays visible and focused during paste
		const handleWindowFocus = async () => {
			if (isDesktop && window.__TAURI_INTERNALS__) {
				try {
					const { getCurrentWindow } = await import('@tauri-apps/api/window');
					const currentWindow = getCurrentWindow();
					await currentWindow.show();
					await currentWindow.unminimize();
					await currentWindow.setFocus();
					// Small delay for window to gain focus
					setTimeout(focusTextarea, 50);
				} catch (e) {
					console.log('Could not manage window state:', e);
					focusTextarea();
				}
			} else {
				focusTextarea();
			}
		};
		window.addEventListener('focus', handleWindowFocus);

		return () => {
			window.removeEventListener('focus', handleWindowFocus);
		};
	});

	// Re-focus textarea when dialog becomes visible (after navigation back from shortcuts)
	$effect(() => {
		if (onboardingStore.isOpen && onboardingStore.currentStep === 'usage-guide') {
			// Aggressive polling to ensure textarea gets focused
			let attempts = 0;
			const maxAttempts = 20;
			const interval = setInterval(() => {
				if (textareaRef && document.activeElement !== textareaRef) {
					textareaRef.focus();
					attempts++;
					if (attempts >= maxAttempts || document.activeElement === textareaRef) {
						clearInterval(interval);
					}
				} else {
					clearInterval(interval);
				}
			}, 50);

			// Cleanup after 2 seconds
			const timeout = setTimeout(() => clearInterval(interval), 2000);

			// Stop fighting the user the moment they deliberately interact
			// with anything — otherwise a click on e.g. "Customize Shortcut"
			// within this 2s window can get its focus yanked back to the
			// textarea mid-click by the next poll tick, making the first
			// click unreliable (had to click twice, intermittently).
			const stopOnUserInput = () => clearInterval(interval);
			document.addEventListener('pointerdown', stopOnUserInput, {
				capture: true,
				once: true,
			});

			// Return cleanup function to properly clear intervals when effect is destroyed
			return () => {
				clearInterval(interval);
				clearTimeout(timeout);
				document.removeEventListener('pointerdown', stopOnUserInput, {
					capture: true,
				});
			};
		}
	});

	// Show confetti when text is first added
	$effect(() => {
		if (hasTried && !hasShownConfetti) {
			hasShownConfetti = true;
			setTimeout(() => celebrate(), 100);
		}
	});

	// Live recorder state drives the ring: breathing → listening → done.
	const recorderStateQuery = createQuery(rpc.recorder.getRecorderState.options);
	const isRecording = $derived(recorderStateQuery.data === 'RECORDING');
	const ringState = $derived(isRecording ? 'listening' : hasTried ? 'done' : 'idle');

	function handleCustomizeShortcut() {
		// Remember where they left off — if they bail out anywhere other than
		// completing the shortcut-recorder dialog (e.g. clicking Home
		// directly from settings), this is what lets the next app-layout
		// mount resume here instead of silently losing the rest of
		// onboarding (including the trial offer) or restarting from scratch.
		settings.updateKey('onboarding.resumeStep', 'usage-guide');

		// Close the dialog first
		onboardingStore.close();

		// Wait for dialog cleanup before navigating
		// The Dialog component needs time to remove body styles
		setTimeout(() => {
			// Ensure body styles are reset before navigation
			if (typeof document !== 'undefined') {
				document.body.style.overflow = '';
				document.body.style.pointerEvents = '';
			}
			goto('/settings/shortcuts/global?from=onboarding');
		}, 150); // Give dialog enough time to fully clean up animations and styles
	}
</script>

<div class="flex flex-col items-center px-8 pt-6 pb-8 space-y-5">
	<VoiceRing state={ringState} size={96} />

	<div class="text-center space-y-1.5">
		<h2 class="text-2xl font-semibold tracking-tight text-white">
			{#if hasTried}
				Zero keystrokes. 🎉
			{:else if isRecording}
				I'm listening…
			{:else}
				Say something
			{/if}
		</h2>
		<p class="text-sm text-white/50">
			{#if hasTried}
				That's the whole trick. It works in every app.
			{:else if isDesktop}
				{#if recordingMode === 'hold'}
					Hold the key, talk, let go.
				{:else}
					Tap the key, talk, tap again.
				{/if}
			{:else}
				Press the shortcut and speak to see the magic
			{/if}
		</p>
	</div>

	{#if isDesktop}
		<div class="flex items-center justify-center gap-2">
			{#each shortcutKeys as key, i}
				<Keycap label={key} demo={!hasTried} active={isRecording} />
				{#if i < shortcutKeys.length - 1}
					<span class="text-white/25 text-sm">+</span>
				{/if}
			{/each}
		</div>
	{/if}

	<!-- Text Editor Playground -->
	<div class="relative w-full">
		<div
			class="w-full rounded-xl border transition-all duration-500 {hasTried
				? 'border-green-500/40 bg-green-500/[0.06] shadow-[0_0_30px_rgba(74,222,128,0.12)]'
				: isRecording
					? 'border-green-500/30 bg-white/[0.03]'
					: 'border-white/10 bg-white/[0.03]'}"
		>
			<div class="flex items-center gap-1.5 px-3 py-2 border-b border-white/5">
				<div class="w-2.5 h-2.5 rounded-full bg-red-500/60"></div>
				<div class="w-2.5 h-2.5 rounded-full bg-yellow-500/60"></div>
				<div class="w-2.5 h-2.5 rounded-full bg-green-500/60"></div>
				<span class="ml-2 text-[10px] text-white/30">Any app, anywhere</span>
				{#if hasTried}
					<div class="ml-auto flex items-center gap-1 text-green-400">
						<CheckIcon class="w-3 h-3" />
						<span class="text-[10px] font-medium">Typed for you</span>
					</div>
				{/if}
			</div>

			<textarea
				bind:this={textareaRef}
				bind:value={editorContent}
				autofocus
				placeholder={isDesktop
					? 'Try: "Remind me to call Alex about the launch tomorrow"'
					: 'Your transcribed text will appear here...'}
				class="w-full min-h-[84px] px-3 py-2.5 bg-transparent text-sm text-white/85 placeholder:text-white/25 resize-none focus:outline-none"
			></textarea>
		</div>
	</div>

	{#if isDesktop && !hasTried}
		<button
			onclick={handleCustomizeShortcut}
			class="flex items-center justify-center gap-1.5 text-xs text-white/35 hover:text-white/60 transition-colors mx-auto cursor-pointer"
		>
			<SettingsIcon class="w-3 h-3" />
			<span>Key not working? Change shortcut</span>
		</button>
	{/if}

	<div class="w-full">
		{#if hasTried}
			<Button onclick={onNext} class="w-full h-11 text-base font-medium cursor-pointer">
				Nice. Show me more →
			</Button>
		{:else}
			<div class="w-full h-11 flex items-center justify-center text-sm text-white/30">
				Your words will appear above
			</div>
		{/if}
	</div>
</div>
