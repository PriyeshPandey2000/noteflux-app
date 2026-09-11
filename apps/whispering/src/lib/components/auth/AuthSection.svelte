<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/ui/button';
	import { auth } from '$lib/stores/auth.svelte';
	import { subscription } from '$lib/stores/subscription.svelte';
	import { ZapIcon } from '@lucide/svelte';
	
	// AuthSection component loaded
	
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
			// Redirect to homepage after sign out
			goto('/');
		} catch (error) {
			console.error('Sign out failed:', error);
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
	{#if auth.isAnonymous}
		<!-- Sign out button without border -->
		<Button onclick={handleSignOut} size="sm" variant="outline">
			Sign Out
		</Button>
	{:else if subscription.isPro}
		<div class="flex items-center gap-3">
			<span class="flex items-center gap-1.5 text-sm font-medium text-purple-700 dark:text-purple-400">
				<ZapIcon class="size-4" />
				Pro
			</span>
			<Button onclick={handleSignOut} size="sm" variant="outline">
				Sign Out
			</Button>
		</div>
	{:else}
		<div class="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
			<div class="flex gap-2">
				<Button onclick={() => subscription.openCheckout('monthly')} size="sm" title="Subscribe monthly">
					Subscribe Monthly
				</Button>
				<Button onclick={() => subscription.openCheckout('yearly')} size="sm" variant="outline" title="Subscribe yearly">
					Subscribe Yearly
				</Button>
			</div>
			<Button onclick={handleSignOut} size="sm" variant="ghost">
				Sign Out
			</Button>
		</div>
	{/if}
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