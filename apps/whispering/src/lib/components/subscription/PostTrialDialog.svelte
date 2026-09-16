<script lang="ts">
	import { postTrialDialog } from '$lib/stores/post-trial-dialog.svelte';
	import { proPricingDialog } from '$lib/stores/pro-pricing-dialog.svelte';
	import { Button } from '$lib/ui/button';
	import * as Dialog from '$lib/ui/dialog';

	function handleGetPro() {
		postTrialDialog.close();
		proPricingDialog.open();
	}
</script>

<Dialog.Root bind:open={postTrialDialog.isOpen}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Your Pro trial has ended</Dialog.Title>
			<Dialog.Description>
				Cloud transcription and AI features (auto-cleanup, custom
				transformations, inline edit) are now Pro-only. Local models stay
				unlimited and free, forever.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-col items-center gap-2 mt-4">
			<Button onclick={handleGetPro} size="sm" class="w-fit min-w-32">
				Get Pro
			</Button>
			<Button onclick={() => postTrialDialog.close()} variant="outline" size="sm" class="w-fit">
				Continue with Free
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
