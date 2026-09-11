<script lang="ts">
	import { auth } from '$lib/stores/auth.svelte';
	import { proPricingDialog } from '$lib/stores/pro-pricing-dialog.svelte';
	import { signupRequiredDialog } from '$lib/stores/signup-required-dialog.svelte';
	import { subscription } from '$lib/stores/subscription.svelte';
	import { Button } from '$lib/ui/button';
	import * as Dialog from '$lib/ui/dialog';

	async function handleSignUp() {
		try {
			await auth.signUp();
		} catch (error) {
			console.error('Sign up failed:', error);
		}
	}

	async function handleSignIn() {
		try {
			await auth.signIn();
		} catch (error) {
			console.error('Sign in failed:', error);
		}
	}

	// Bring window to focus when signup modal opens
	$effect(() => {
		if (signupRequiredDialog.isOpen && window.__TAURI_INTERNALS__) {
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

	// Auto-close dialog when user successfully authenticates and is no longer anonymous
	$effect(() => {
		if (signupRequiredDialog.isOpen && auth.isAuthenticated && !auth.isAnonymous) {
			// Check state before closing the dialog resets it
			const shouldReopenOnboarding = signupRequiredDialog.wasOnboardingOpen;
			const shouldOpenProPaywall = signupRequiredDialog.reason === 'pro';

			signupRequiredDialog.close();

			if (shouldOpenProPaywall) {
				// They tapped "Get Pro" while anonymous. If they signed into an
				// existing account (not a fresh signup), that account could
				// already be Pro — confirm status before opening the paywall
				// instead of racing a fixed delay against the async refresh,
				// so an existing Pro user is never shown a "buy Pro" screen.
				(async () => {
					await subscription.checkSubscription();
					if (!subscription.isPro) {
						proPricingDialog.open();
					}
				})();
			} else if (shouldReopenOnboarding) {
				// If user was in onboarding flow, reopen it at the usage guide step.
				// Small delay to let the signup dialog close smoothly.
				setTimeout(async () => {
					const { onboardingStore } = await import('$lib/stores/onboarding.svelte');
					const { goto } = await import('$app/navigation');

					// Navigate back to home
					await goto('/');

					// Reopen onboarding at usage guide step
					onboardingStore.openAt('usage-guide');
				}, 300);
			}
		}
	});
</script>

<Dialog.Root bind:open={signupRequiredDialog.isOpen}>
	<Dialog.Content
		class="max-w-md z-[9999]"
		onInteractOutside={(e) => {
			// Usage-limit signup is mandatory to keep recording; the Pro variant
			// is just an upsell, so let it be dismissed normally.
			if (signupRequiredDialog.reason === 'usage-limit') {
				e.preventDefault();
			}
		}}
		onEscapeKeydown={(e) => {
			if (signupRequiredDialog.reason === 'usage-limit') {
				e.preventDefault();
			}
		}}
		showCloseButton={signupRequiredDialog.reason === 'pro'}
	>
		<Dialog.Header>
			{#if signupRequiredDialog.reason === 'pro'}
				<Dialog.Title>Sign up to unlock Pro</Dialog.Title>
				<Dialog.Description>
					Create a free account to continue to checkout.
				</Dialog.Description>
			{:else}
				<Dialog.Title>Sign up to continue recording</Dialog.Title>
				<Dialog.Description>
					Please sign up to keep using the app.
				</Dialog.Description>
			{/if}
		</Dialog.Header>

		<div class="flex flex-col gap-2 mt-4">
			<Button onclick={handleSignUp} size="default" class="w-full">
				Sign Up
			</Button>
			<Button onclick={handleSignIn} variant="outline" size="default" class="w-full">
				Already have an account? Sign In
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
