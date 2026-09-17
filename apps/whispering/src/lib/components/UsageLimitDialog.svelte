<script lang="ts">
	import { Button } from '$lib/ui/button';
	import * as Dialog from '$lib/ui/dialog';
	import { BugIcon } from '@lucide/svelte';
	import FeedbackDialog from '$lib/components/feedback/FeedbackDialog.svelte';

	let { 
		open = $bindable(false),
		totalMinutes = 0,
		limitMinutes = 2000
	}: { 
		open?: boolean;
		totalMinutes?: number;
		limitMinutes?: number;
	} = $props();

	let showFeedbackDialog = $state(false);

	function handleReportUsage() {
		// Close this dialog and open feedback dialog
		open = false;
		showFeedbackDialog = true;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<span class="text-2xl">⚠️</span>
				Usage Limit Reached
			</Dialog.Title>
			<Dialog.Description>
				You've reached your transcription usage limit.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4">
			<div class="rounded-lg bg-muted p-4">
				<div class="text-sm text-muted-foreground">Total Usage</div>
				<div class="text-2xl font-bold">
					{totalMinutes.toFixed(0)} minutes
				</div>
			</div>

			<div class="text-sm text-muted-foreground">
				Need more usage? Use the bug report icon on the homepage to request additional minutes.
			</div>
		</div>

		<Dialog.Footer class="flex gap-2">
			<Button variant="outline" size="sm" onclick={() => (open = false)}>
				Close
			</Button>
			<Button onclick={handleReportUsage} size="sm" class="flex items-center gap-2">
				<BugIcon class="size-4" />
				Report Usage Request
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<FeedbackDialog bind:open={showFeedbackDialog} />