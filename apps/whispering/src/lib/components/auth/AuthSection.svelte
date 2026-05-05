<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/ui/button';
	import { auth } from '$lib/stores/auth.svelte';
	import { subscription } from '$lib/services/subscription/polar';
	import { ZapIcon } from '@lucide/svelte';
	
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
	
	async function handleSignOut() {
		try {
			await auth.signOut();
			goto('/');
		} catch (error) {
			console.error('Sign out failed:', error);
		}
	}

	async function handleSubscribe() {
		try {
			await subscription.openCheckout(auth.user);
		} catch (error) {
			console.error('Subscribe failed:', error);
		}
	}
	
</script>

{#if auth.isLoading}
	<div class="flex flex-col items-center gap-4 p-4 border rounded-lg bg-muted/20">
		<div class="text-center">
			<p class="text-sm text-muted-foreground mb-2">Loading authentication...</p>
			<Button disabled size="sm">
				Loading...
			</Button>
		</div>
	</div>
{:else if auth.isAuthenticated}
	<div class="flex items-center gap-3">
		<Button onclick={handleSubscribe} size="sm">
			Subscribe
		</Button>
		<Button onclick={handleSignOut} size="sm" variant="outline">
			Sign Out
		</Button>
	</div>
{:else}
	<div class="flex flex-col items-center gap-4 p-4 border rounded-lg bg-muted/20">
		<div class="text-center">
			<p class="text-sm text-muted-foreground mb-3">
				Sign in to sync your recordings and settings
			</p>
			<div class="flex gap-2 justify-center">
				<Button onclick={handleSignIn} size="sm" variant="default">
					Sign In
				</Button>
				<Button onclick={handleSignUp} size="sm" variant="outline">
					Sign Up
				</Button>
			</div>
		</div>
	</div>
{/if}