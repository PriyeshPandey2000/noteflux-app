<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { rpc } from '$lib/query';
	import OnboardingButton from './OnboardingButton.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { onMount } from 'svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import WandIcon from '@lucide/svelte/icons/wand-sparkles';
	import { celebrate } from './celebrate';
	import Keycap from './Keycap.svelte';
	import VoiceRing from './VoiceRing.svelte';

	type Props = {
		onNext: () => void;
	};

	let { onNext }: Props = $props();

	// Multiple distinct clauses on purpose — a single short sentence gives the
	// model nothing to restructure, so "turn it into bullets" (or even
	// "make it shorter") can legitimately no-op and return the text
	// unchanged (the system prompt explicitly allows that when it judges no
	// real change is needed). Three joined action items means every
	// suggested prompt below produces a visibly different result reliably.
	const SAMPLE_TEXT =
		'we shoudl ship the new pricing page by friday also need to fix the login bug and someone should update the docs';

	// Real, non-readonly textarea — paste-back after the edit needs to land
	// somewhere real (a readonly field would silently reject it). The
	// existing selection capture in commands.ts reads whatever
	// TEXTAREA/INPUT is focused with a real selectionStart/selectionEnd at
	// shortcut-press time — this is that.
	let editorContent = $state(SAMPLE_TEXT);
	let textareaRef = $state<HTMLTextAreaElement | null>(null);
	let hasEdited = $derived(editorContent.trim() !== SAMPLE_TEXT.trim());
	let hasCelebrated = $state(false);

	const isDesktop = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

	const recordingMode = $derived(settings.value['shortcuts.recordingMode']);
	const shortcut = $derived(
		recordingMode === 'hold'
			? settings.value['shortcuts.global.pushToTalk'] || 'Fn'
			: settings.value['shortcuts.global.toggleManualRecording'] || 'Option+Space',
	);
	const shortcutKeys = $derived(shortcut.split('+').map((key) => key.trim()));

	const recorderStateQuery = createQuery(rpc.recorder.getRecorderState.options);
	const isRecording = $derived(recorderStateQuery.data === 'RECORDING');
	const ringState = $derived(isRecording ? 'listening' : hasEdited ? 'done' : 'idle');

	const PROMPTS = [
		'"convert it to French"',
		'"make it more formal"',
		'"turn it into bullets"',
	];

	onMount(() => {
		// No pre-selection — selecting the text themselves is part of the
		// demo now, not something done for them.
		if (textareaRef) {
			textareaRef.focus();
		}
	});

	$effect(() => {
		if (hasEdited && !hasCelebrated) {
			hasCelebrated = true;
			setTimeout(() => celebrate({ particleCount: 140 }), 100);
		}
	});
</script>

<div class="flex flex-col items-center px-8 pt-6 pb-8 space-y-5">
	<VoiceRing state={ringState} size={96} />

	<div class="text-center space-y-1.5">
		<h2 class="text-2xl font-semibold tracking-tight text-white">
			{#if hasEdited}
				Rewritten in place. ✨
			{:else if isRecording}
				Tell me what to change…
			{:else}
				Now, edit with your voice
			{/if}
		</h2>
		<p class="text-sm text-white/50">
			{#if hasEdited}
				No copy, no paste, no retyping. Select any text, anywhere.
			{:else}
				Select some text below. Hold the key and say how to fix it.
			{/if}
		</p>
	</div>

	{#if isDesktop}
		<div class="flex items-center justify-center gap-2">
			{#each shortcutKeys as key, i}
				<Keycap label={key} demo={!hasEdited} active={isRecording} />
				{#if i < shortcutKeys.length - 1}
					<span class="text-white/25 text-sm">+</span>
				{/if}
			{/each}
		</div>
	{/if}

	{#if !hasEdited}
		<div class="flex flex-wrap items-center justify-center gap-1.5">
			<span class="text-[11px] text-white/35 mr-0.5">Try</span>
			{#each PROMPTS as prompt (prompt)}
				<span
					class="px-2.5 py-1 rounded-full text-[11px] text-green-200/80 border border-green-500/20 bg-green-500/[0.06]"
				>
					{prompt}
				</span>
			{/each}
		</div>
	{/if}

	<div
		class="relative w-full rounded-xl border transition-all duration-500 {hasEdited
			? 'border-green-500/40 bg-green-500/[0.06] shadow-[0_0_30px_rgba(74,222,128,0.12)]'
			: isRecording
				? 'border-green-500/30 bg-white/[0.03]'
				: 'border-white/10 bg-white/[0.03]'}"
	>
		<div class="flex items-center gap-1.5 px-3 py-2 border-b border-white/5">
			<div class="w-2.5 h-2.5 rounded-full bg-red-500/60"></div>
			<div class="w-2.5 h-2.5 rounded-full bg-yellow-500/60"></div>
			<div class="w-2.5 h-2.5 rounded-full bg-green-500/60"></div>
			<span class="ml-2 text-[10px] text-white/30">Your messy draft</span>
			<div class="ml-auto flex items-center gap-1 {hasEdited ? 'text-green-400' : 'text-white/30'}">
				{#if hasEdited}
					<CheckIcon class="w-3 h-3" />
					<span class="text-[10px] font-medium">Edited by voice</span>
				{:else}
					<WandIcon class="w-3 h-3" />
					<span class="text-[10px] font-medium">AI edit</span>
				{/if}
			</div>
		</div>
		<textarea
			bind:this={textareaRef}
			bind:value={editorContent}
			class="w-full min-h-[84px] px-3 py-2.5 bg-transparent text-sm text-white/85 resize-none focus:outline-none selection:bg-green-500/35 selection:text-white"
		></textarea>
	</div>

	<div class="w-full">
		{#if hasEdited}
			<OnboardingButton onclick={onNext} class="w-full h-11 text-base cursor-pointer">
				That's wild. Continue →
			</OnboardingButton>
		{:else}
			<div class="w-full h-11 flex items-center justify-center text-sm text-white/30">
				Select some text, then hold {shortcut} and speak
			</div>
		{/if}
	</div>
</div>
