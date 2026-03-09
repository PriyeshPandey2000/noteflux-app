<script lang="ts">
	import { getPhoneticCode } from '$lib/utils/dictionary';
	import { settings } from '$lib/stores/settings.svelte';
	import { Button } from '$lib/ui/button';
	import { Input } from '$lib/ui/input';
	import { Separator } from '$lib/ui/separator';
	import { TrashIcon } from '@lucide/svelte';

	let newWord = $state('');

	function addWord() {
		const trimmed = newWord.trim();
		if (!trimmed) return;
		const entries = settings.value['transcription.dictionary'];
		const already = entries.some((e) => e.word.toLowerCase() === trimmed.toLowerCase());
		if (already) return;
		settings.updateKey('transcription.dictionary', [
			...entries,
			{ word: trimmed, phoneticCode: getPhoneticCode(trimmed) },
		]);
		newWord = '';
	}

	function removeWord(word: string) {
		settings.updateKey(
			'transcription.dictionary',
			settings.value['transcription.dictionary'].filter((e) => e.word !== word),
		);
	}
</script>

<svelte:head>
	<title>Dictionary - NoteFlux</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h3 class="text-lg font-medium">Dictionary</h3>
		<p class="text-muted-foreground text-sm">
			Add words that get mis-transcribed. The app will automatically detect and correct
			mis-spellings on every transcription.
		</p>
	</div>
	<Separator />

	<div class="flex gap-2">
		<Input
			placeholder="e.g. NoteFlux, Priyesh, shadcn"
			bind:value={newWord}
			onkeydown={(e) => {
				if (e.key === 'Enter') addWord();
			}}
		/>
		<Button onclick={addWord} disabled={!newWord.trim()}>Add</Button>
	</div>

	{#if settings.value['transcription.dictionary'].length === 0}
		<p class="text-muted-foreground text-sm">No words added yet.</p>
	{:else}
		<ul class="space-y-2">
			{#each settings.value['transcription.dictionary'] as entry (entry.word)}
				<li class="flex items-center justify-between rounded-md border px-3 py-2">
					<span class="text-sm font-medium">{entry.word}</span>
					<Button
						variant="ghost"
						size="icon"
						onclick={() => removeWord(entry.word)}
						aria-label="Remove {entry.word}"
					>
						<TrashIcon class="size-4" />
					</Button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
