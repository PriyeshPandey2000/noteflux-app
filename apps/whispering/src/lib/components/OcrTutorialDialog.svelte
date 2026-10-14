<script lang="ts">
	import FeatureIntroCard from './FeatureIntroCard.svelte';
	import Keycap from './onboarding/Keycap.svelte';
	import { analytics } from '$lib/services/posthog';
	import { featureTutorial } from '$lib/stores/feature-tutorial.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import * as Dialog from '$lib/ui/dialog';
	import { readImage } from '@tauri-apps/plugin-clipboard-manager';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ScanTextIcon from '@lucide/svelte/icons/scan-text';
	import { onDestroy } from 'svelte';

	let open = $state(false);

	// Our shortcut only extracts text from whatever image is already on the
	// clipboard — it doesn't take the screenshot itself. So step 1 is macOS's
	// own screenshot-to-clipboard shortcut, not ours. We poll the clipboard
	// while the dialog is open and flag it the moment a *new* image lands,
	// so step 2 (ours) only lights up once there's actually something to
	// extract — otherwise "Try it" with nothing copied just silently no-ops.
	let hasFreshClipboardImage = $state(false);
	let baselineImageKey: string | null = null;
	let pollId: ReturnType<typeof setInterval> | null = null;

	const shortcut = $derived(
		settings.value['shortcuts.global.extractTextFromClipboard'] || 'Command+Option+T',
	);
	const shortcutKeys = $derived(shortcut.split('+').map((key) => key.trim()));
	const shortcutSpelledOut = $derived(shortcutKeys.join(' + '));
	const isComplete = $derived(featureTutorial.completedFeature === 'ocr');

	async function clipboardImageKey() {
		try {
			const image = await readImage();
			const size = await image.size();
			return `${size.width}x${size.height}`;
		} catch {
			return null; // no image on the clipboard right now — the common case
		}
	}

	function stopPolling() {
		if (pollId) clearInterval(pollId);
		pollId = null;
	}

	async function startPolling() {
		baselineImageKey = await clipboardImageKey();
		pollId = setInterval(async () => {
			const key = await clipboardImageKey();
			if (key && key !== baselineImageKey) {
				hasFreshClipboardImage = true;
				stopPolling();
			}
		}, 800);
	}

	function handleOpenChange(next: boolean) {
		open = next;
		if (next) {
			hasFreshClipboardImage = false;
			featureTutorial.start('ocr');
			analytics.trackOcrTutorialStarted();
			startPolling();
			return;
		}
		stopPolling();
		// Completion is detected live while the dialog is open (see the
		// trackOcrSucceeded call site in lib/commands.ts), so by the time it
		// closes featureTutorial already knows whether it happened.
		if (featureTutorial.completedFeature === 'ocr') {
			analytics.trackOcrTutorialCompleted();
			// Persisted (not just in-memory) so the card stays gone across
			// restarts once the user has actually tried the feature.
			settings.updateKey('onboarding.ocrTutorialCompleted', true);
		}
		featureTutorial.clear();
	}

	onDestroy(stopPolling);
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Trigger
		class="cursor-pointer rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
	>
		<FeatureIntroCard
			variant="ocr"
			title="Screenshot OCR"
			description="Copy any screenshot, then pull its text out instantly — no typing it out by hand."
			ctaLabel="Try it"
			icon={ScanTextIcon}
		/>
	</Dialog.Trigger>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Screenshot OCR</Dialog.Title>
			<Dialog.Description>Two steps: screenshot it, then extract it.</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-col gap-3">
			<div
				class="rounded-lg border p-3 {hasFreshClipboardImage
					? 'border-green-500/40 bg-green-500/5'
					: 'border-border'}"
			>
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium">1. Screenshot something</span>
					{#if hasFreshClipboardImage}
						<CheckIcon class="size-4 text-green-600 dark:text-green-400" />
					{/if}
				</div>
				<p class="mt-2 font-mono text-sm font-semibold">⌘ ⌃ ⇧ 4</p>
				<p class="mt-0.5 text-xs text-muted-foreground">
					Command + Control + Shift + 4 — macOS's default shortcut to copy a
					screenshot straight to the clipboard. Remapped it in System
					Settings? Use your version instead.
				</p>
			</div>

			<div
				class="rounded-lg border p-3 transition-opacity {hasFreshClipboardImage || isComplete
					? 'opacity-100'
					: 'opacity-40'} {isComplete ? 'border-green-500/40 bg-green-500/5' : 'border-border'}"
			>
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium">2. Extract the text</span>
					{#if isComplete}
						<CheckIcon class="size-4 text-green-600 dark:text-green-400" />
					{/if}
				</div>
				<div class="mt-2 flex items-center gap-2">
					{#each shortcutKeys as key, i (key)}
						<Keycap label={key} demo={hasFreshClipboardImage && !isComplete} active={isComplete} />
						{#if i < shortcutKeys.length - 1}
							<span class="text-muted-foreground text-sm">+</span>
						{/if}
					{/each}
				</div>
				<p class="mt-1.5 text-xs text-muted-foreground">{shortcutSpelledOut}</p>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
