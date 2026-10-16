<script lang="ts">
	import CopyableTextareaExpandsToDialog from '$lib/components/copyable/CopyableTextareaExpandsToDialog.svelte';
	import { rpc } from '$lib/query';
	import { settings } from '$lib/stores/settings.svelte';
	import { Skeleton } from '$lib/ui/skeleton';
	import { getRecordingTransitionId } from '$lib/utils/getRecordingTransitionId';
	import { createQuery } from '@tanstack/svelte-query';

	let {
		recordingId,
		rows = 2,
		textareaClass = '',
		transcribedText,
	}: {
		recordingId: string;
		rows?: number;
		textareaClass?: string;
		transcribedText: string;
	} = $props();

	// Check if there's a transformation result for this recording
	const latestTransformationRunQuery = createQuery(
		rpc.transformationRuns.getLatestTransformationRunByRecordingId(
			() => recordingId,
		).options,
	);

	const id = getRecordingTransitionId({
		propertyName: 'transcribedText',
		recordingId,
	});

	// Check if a transformation is currently selected in settings
	const hasSelectedTransformation = $derived(
		settings.value['transformations.selectedTransformationId'] !== null
	);

	// Determine what text to show based on transformation status
	const displayText = $derived.by(() => {
		const transformationRun = latestTransformationRunQuery.data;
		
		// If transformation exists and completed successfully, show transformed text
		if (transformationRun?.status === 'completed') {
			return transformationRun.output;
		}
		
		// If transformation is selected but not completed yet, show nothing (wait)
		if (hasSelectedTransformation && latestTransformationRunQuery.isPending) {
			return '';
		}
		
		// If transformation failed or no transformation selected, show raw text
		return transcribedText;
	});

	const displayTitle = $derived.by(() => {
		const transformationRun = latestTransformationRunQuery.data;
		return transformationRun?.status === 'completed' ? 'Transformed Text' : 'Transcribed Text';
	});

	// Determine if we should show the component at all
	const shouldShow = $derived.by(() => {
		// If no transformation is selected, always show raw text
		if (!hasSelectedTransformation) {
			return true;
		}
		
		// If transformation is selected, only show when we have a result
		return !latestTransformationRunQuery.isPending && displayText !== '';
	});

	// COMMENTED OUT: Original simple implementation
	// const id = getRecordingTransitionId({
	// 	propertyName: 'transcribedText',
	// 	recordingId,
	// });
</script>

{#if latestTransformationRunQuery.isPending && hasSelectedTransformation}
	<!-- Show skeleton while waiting for transformation to complete -->
	<div class="space-y-1">
		<Skeleton class="h-3" />
		<Skeleton class="h-3" />
	</div>
{:else if shouldShow}
	<CopyableTextareaExpandsToDialog
		{id}
		title={displayTitle}
		label="text"
		text={displayText}
		{rows}
		{textareaClass}
	/>
{/if}

<!-- COMMENTED OUT: Original simple implementation
<CopyableTextareaExpandsToDialog
	{id}
	title="Transcribed Text"
	label="transcribed text"
	text={transcribedText}
	{rows}
/>
-->
