<script lang="ts">
	import FeatureIntroCard from './FeatureIntroCard.svelte';
	import Keycap from './onboarding/Keycap.svelte';
	import { analytics } from '$lib/services/posthog';
	import { featureTutorial } from '$lib/stores/feature-tutorial.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import * as Dialog from '$lib/ui/dialog';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MicIcon from '@lucide/svelte/icons/mic';

	let open = $state(false);

	const shortcut = $derived(
		settings.value['shortcuts.global.askOverlay'] || 'Control+Option+Space',
	);
	const shortcutKeys = $derived(shortcut.split('+').map((key) => key.trim()));
	const shortcutSpelledOut = $derived(shortcutKeys.join(' + '));
	const isComplete = $derived(featureTutorial.completedFeature === 'ask');

	function handleOpenChange(next: boolean) {
		open = next;
		if (next) {
			featureTutorial.start('ask');
			analytics.trackAskTutorialStarted();
			return;
		}
		// Completion is detected live while the dialog is open (see the
		// trackAskAnswerReceived call site in query/commands.ts), so by the
		// time it closes featureTutorial already knows whether it happened.
		if (featureTutorial.completedFeature === 'ask') {
			analytics.trackAskTutorialCompleted();
			// Persisted (not just in-memory) so the card stays gone across
			// restarts once the user has actually tried the feature.
			settings.updateKey('onboarding.askTutorialCompleted', true);
		}
		featureTutorial.clear();
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Trigger
		class="cursor-pointer rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
	>
		<FeatureIntroCard
			variant="ask"
			title="Ask AI"
			description="Ask AI out loud, from any app: text or screenshot, your call."
			ctaLabel="Try it"
			icon={MicIcon}
		/>
	</Dialog.Trigger>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Ask AI</Dialog.Title>
			<Dialog.Description>
				{#if isComplete}
					Nailed it — that's Ask. Works from anywhere, no app-switching.
				{:else}
					Press this shortcut from anywhere, then ask your question out loud.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-col items-center gap-1.5 py-4">
			<div class="flex items-center justify-center gap-2">
				{#each shortcutKeys as key, i (key)}
					<Keycap label={key} demo={!isComplete} active={isComplete} />
					{#if i < shortcutKeys.length - 1}
						<span class="text-muted-foreground text-sm">+</span>
					{/if}
				{/each}
			</div>
			<p class="text-xs text-muted-foreground">{shortcutSpelledOut}</p>
		</div>

		{#if isComplete}
			<div class="flex items-center justify-center gap-1.5 text-sm font-medium text-green-600 dark:text-green-400">
				<CheckIcon class="size-4" />
				Question answered
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
