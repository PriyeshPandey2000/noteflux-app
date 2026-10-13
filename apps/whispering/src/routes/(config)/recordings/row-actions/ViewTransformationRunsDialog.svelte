<script lang="ts">
	import { Runs } from '$lib/components/transformations-editor';
	import { rpc } from '$lib/query';
	import { Button } from '$lib/ui/button';
	import * as Dialog from '$lib/ui/dialog';
	import { createQuery } from '@tanstack/svelte-query';

	let {
		recordingId,
		open = $bindable(false),
	}: { recordingId: string; open?: boolean } = $props();

	const transformationRunsByRecordingIdQuery = createQuery(
		rpc.transformationRuns.getTransformationRunsByRecordingId(() => recordingId)
			.options,
	);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-4xl">
		<Dialog.Header>
			<Dialog.Title>Transformation Runs</Dialog.Title>
			<Dialog.Description>
				View all transformation runs for this recording
			</Dialog.Description>
		</Dialog.Header>
		<div class="max-h-[60vh] overflow-y-auto">
			{#if transformationRunsByRecordingIdQuery.isPending}
				<div class="text-muted-foreground text-sm">Loading runs...</div>
			{:else if transformationRunsByRecordingIdQuery.error}
				<div class="text-destructive text-sm">
					{transformationRunsByRecordingIdQuery.error.message}
				</div>
			{:else if transformationRunsByRecordingIdQuery.data}
				<Runs runs={transformationRunsByRecordingIdQuery.data} />
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
