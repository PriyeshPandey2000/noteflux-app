<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/ui/button';
	import { auth } from '$lib/stores/auth.svelte';
	import { proPricingDialog } from '$lib/stores/pro-pricing-dialog.svelte';
	import { signupRequiredDialog } from '$lib/stores/signup-required-dialog.svelte';
	import { subscription } from '$lib/stores/subscription.svelte';
	import { cn } from '$lib/ui/utils';
	import { Loader } from '@lucide/svelte';

	// AuthSection component loaded

	function onGetProClick() {
		if (auth.isAnonymous) {
			signupRequiredDialog.open(false, 'pro');
		} else {
			proPricingDialog.open();
		}
	}

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
	{#if subscription.isPro}
		<div class="flex flex-col items-center gap-1">
			<div class="flex items-center gap-3">
				<span class="text-sm font-semibold tracking-wide bg-gradient-to-r from-green-400 via-green-500 to-emerald-400 bg-clip-text text-transparent">Pro</span>
				<Button onclick={handleSignOut} size="sm" variant="outline">
					Sign Out
				</Button>
			</div>
			<span class="text-xs text-muted-foreground whitespace-nowrap" title={auth.user?.email}>{auth.user?.email}</span>
		</div>
	{:else if subscription.isConfirmingCheckout}
		<div class="flex flex-col items-center gap-1">
			<div class="flex items-center gap-3">
				<span class="flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
					<Loader class="size-4 animate-spin" />
					Confirming payment… (~2-3 min)
				</span>
				<Button onclick={handleSignOut} size="sm" variant="outline">
					Sign Out
				</Button>
			</div>
			<span class="text-xs text-muted-foreground whitespace-nowrap" title={auth.user?.email}>{auth.user?.email}</span>
		</div>
	{:else if subscription.isKnown && subscription.isTrialActive}
		<div class="flex flex-col items-center gap-1">
			<div class="flex items-center gap-3">
			<button
				type="button"
				onclick={onGetProClick}
				title="Pro trial"
				class={cn(
					'flex items-center whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-semibold tracking-wide transition-colors cursor-pointer',
					subscription.trialDaysLeft <= 1
						? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
						: 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10'
				)}
			>
				<span class="whitespace-nowrap bg-gradient-to-r from-green-400 via-green-500 to-emerald-400 bg-clip-text text-transparent">
					Pro trial
				</span>
				<span class={cn('ml-1.5 whitespace-nowrap text-xs font-normal', subscription.trialDaysLeft <= 1 ? 'text-amber-400' : 'text-muted-foreground')}>
					{subscription.trialDaysLeft <= 1 ? 'ends tomorrow' : `${subscription.trialDaysLeft} days left`}
				</span>
			</button>
			<Button onclick={handleSignOut} size="sm" variant="outline">
				Sign Out
			</Button>
			</div>
			<span class="text-xs text-muted-foreground whitespace-nowrap" title={auth.user?.email}>{auth.user?.email}</span>
		</div>
	{:else if auth.isAnonymous}
		<!-- Anonymous users never consciously signed in, so "Sign Out" doesn't
		     match their mental model — offer Sign In/Sign Up instead. Get Pro
		     stays visible so there's always a path to it; clicking it while
		     anonymous opens the sign-up gate first. -->
		<div class="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
			<button
				type="button"
				onclick={onGetProClick}
				title="Get Pro"
				class="flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-sm font-semibold tracking-wide hover:bg-emerald-500/10 transition-colors cursor-pointer"
			>
				<span class="bg-gradient-to-r from-green-400 via-green-500 to-emerald-400 bg-clip-text text-transparent">
					Get Pro
				</span>
			</button>
			<Button onclick={handleSignIn} size="sm" variant="outline">
				Sign In
			</Button>
			<Button onclick={handleSignUp} size="sm" variant="ghost">
				Sign Up
			</Button>
		</div>
	{:else if subscription.isKnown}
		<div class="flex flex-col items-center gap-1">
			<div class="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
				<button
					type="button"
					onclick={onGetProClick}
					title="Get Pro"
					class="flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-sm font-semibold tracking-wide hover:bg-emerald-500/10 transition-colors cursor-pointer"
				>
					<span class="bg-gradient-to-r from-green-400 via-green-500 to-emerald-400 bg-clip-text text-transparent">
						Get Pro
					</span>
				</button>
				<Button onclick={handleSignOut} size="sm" variant="ghost">
					Sign Out
				</Button>
			</div>
			<span class="text-xs text-muted-foreground whitespace-nowrap" title={auth.user?.email}>{auth.user?.email}</span>
		</div>
	{:else}
		<div class="flex flex-col items-center gap-1">
			<Button onclick={handleSignOut} size="sm" variant="outline">
				Sign Out
			</Button>
			<span class="text-xs text-muted-foreground whitespace-nowrap" title={auth.user?.email}>{auth.user?.email}</span>
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