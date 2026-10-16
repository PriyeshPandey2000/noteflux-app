<script lang="ts">
	import { Button } from '$lib/ui/button';
	import * as Dialog from '$lib/ui/dialog';
	import { auth } from '$lib/stores/auth.svelte';
	import { authRequiredDialog } from '$lib/stores/auth-required-dialog.svelte';
	import LockIcon from '@lucide/svelte/icons/lock';

	async function handleSignIn() {
		try {
			await auth.signIn();
		} catch (error) {
			console.error('Sign in failed:', error);
		}
	}

	async function handleSignUp() {
		try {
			await auth.signUp();
		} catch (error) {
			console.error('Sign up failed:', error);
		}
	}

	// Bring window to focus when auth modal opens
	$effect(() => {
		if (authRequiredDialog.isOpen && window.__TAURI_INTERNALS__) {
			(async () => {
				try {
					const { getCurrentWindow } = await import('@tauri-apps/api/window');
					const currentWindow = getCurrentWindow();
					await currentWindow.setFocus();
					await currentWindow.setAlwaysOnTop(true);
					// Remove always-on-top after a brief moment
					setTimeout(async () => {
						await currentWindow.setAlwaysOnTop(false);
					}, 500);
				} catch (error) {
					console.error('Failed to bring window to focus:', error);
				}
			})();
		}
	});

	// Auto-close dialog when user successfully authenticates
	$effect(() => {
		if (authRequiredDialog.isOpen && auth.isAuthenticated) {
			authRequiredDialog.close();
		}
	});
</script>

<Dialog.Root bind:open={authRequiredDialog.isOpen}>
	<Dialog.Content
		class="max-w-md"
		onInteractOutside={(e) => {
			// Always non-dismissible - if auth is required, user must authenticate
			e.preventDefault();
		}}
		onEscapeKeydown={(e) => {
			// Always non-dismissible - if auth is required, user must authenticate
			e.preventDefault();
		}}
		showCloseButton={false}
	>
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<span class="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
					<LockIcon class="size-4 text-muted-foreground" />
				</span>
				Authentication Required
			</Dialog.Title>
			<Dialog.Description>
				Please sign in to use recording and transcription features.
			</Dialog.Description>
		</Dialog.Header>

		<Dialog.Footer class="flex gap-2">
			<Button variant="outline" onclick={handleSignUp}>
				Sign Up
			</Button>
			<Button onclick={handleSignIn}>
				Sign In
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

