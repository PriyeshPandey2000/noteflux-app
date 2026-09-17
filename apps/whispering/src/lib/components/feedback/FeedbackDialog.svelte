<script lang="ts">
	import { rpc } from '$lib/query';
	import { Button } from '$lib/ui/button';
	import * as Dialog from '$lib/ui/dialog';
	import { Label } from '$lib/ui/label';
	import { Textarea } from '$lib/ui/textarea';
	import { createMutation } from '@tanstack/svelte-query';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let message = $state('');

	const feedbackMutation = createMutation(rpc.feedback.mutations.submitFeedback.options);

	function handleSubmit() {
		if (!message.trim()) {
			rpc.notify.error.execute({
				title: '❌ Message required',
				description: 'Please enter your feedback message',
			});
			return;
		}

		feedbackMutation.mutate(
			{
				type: 'bug',
				message: message.trim(),
			},
			{
				onSuccess: () => {
					rpc.notify.success.execute({
						title: '✅ Feedback submitted!',
						description: 'Thank you for your feedback. We will review it soon.',
					});
					// Reset form
					message = '';
					open = false;
				},
				onError: (error) => {
					rpc.notify.error.execute({
						title: '❌ Failed to submit feedback',
						description: error.message || 'Please try again later',
					});
				},
			},
		);
	}

	// Reset form when dialog closes
	$effect(() => {
		if (!open) {
			message = '';
		}
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Share Feedback</Dialog.Title>
			<Dialog.Description>
				Help us improve NoteFlux by reporting bugs or suggesting features.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4">
			<!-- Message Input -->
			<div class="space-y-2">
				<Label for="feedback-message">Message</Label>
				<Textarea
					id="feedback-message"
					bind:value={message}
					placeholder="Describe the issue, bug, or feature request..."
					rows={5}
					class="resize-none"
				/>
			</div>
		</div>

		<Dialog.Footer class="flex gap-2">
			<Button variant="outline" onclick={() => (open = false)}>
				Cancel
			</Button>
			<Button
				onclick={handleSubmit}
				disabled={feedbackMutation.isPending || !message.trim()}
			>
				{#if feedbackMutation.isPending}
					Submitting...
				{:else}
					Submit Feedback
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
