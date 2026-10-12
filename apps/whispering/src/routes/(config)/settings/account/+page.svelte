<script lang="ts">
	import { goto } from '$app/navigation';
	import { rpc } from '$lib/query';
	import { auth } from '$lib/stores/auth.svelte';
	import { proPricingDialog } from '$lib/stores/pro-pricing-dialog.svelte';
	import { subscription } from '$lib/stores/subscription.svelte';
	import { Button } from '$lib/ui/button';
	import { Separator } from '$lib/ui/separator';
	import { Loader } from '@lucide/svelte';

	const periodEndLabel = $derived(
		subscription.currentPeriodEnd
			? new Date(subscription.currentPeriodEnd).toLocaleDateString(undefined, {
					year: 'numeric',
					month: 'long',
					day: 'numeric',
				})
			: null,
	);

</script>

<svelte:head>
	<title>Account - NoteFlux</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h3 class="text-lg font-medium">Account</h3>
		<p class="text-muted-foreground text-sm">
			Manage your plan, billing, and subscription.
		</p>
	</div>

	<Separator />

	{#if !auth.isAuthenticated}
		<p class="text-muted-foreground text-sm">Sign in to view your account.</p>
	{:else}
		<div class="rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
			<div class="flex items-start justify-between gap-4">
				<div class="space-y-1">
					<p class="text-sm text-muted-foreground">Signed in as</p>
					<p class="font-medium">{auth.user?.email}</p>
					<Button
						onclick={async () => {
							try {
								await auth.signOut();
								goto('/');
							} catch (error) {
								console.error('Sign out failed:', error);
							}
						}}
						size="sm"
						variant="ghost"
						class="-ml-3"
					>
						Sign Out
					</Button>
				</div>

				{#if subscription.isPro}
					<span
						class="whitespace-nowrap rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-sm font-semibold tracking-wide bg-gradient-to-r from-green-400 via-green-500 to-emerald-400 bg-clip-text text-transparent"
					>
						Pro
					</span>
				{:else if subscription.isConfirmingCheckout}
					<span class="flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-emerald-400">
						<Loader class="size-4 animate-spin" />
						Confirming payment…
					</span>
				{:else if subscription.isKnown && subscription.isTrialActive}
					<span
						class="whitespace-nowrap rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-sm font-semibold tracking-wide bg-gradient-to-r from-green-400 via-green-500 to-emerald-400 bg-clip-text text-transparent"
					>
						Pro trial · {subscription.trialDaysLeft <= 1 ? 'ends tomorrow' : `${subscription.trialDaysLeft}d left`}
					</span>
				{:else}
					<span class="whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium text-muted-foreground">
						Free
					</span>
				{/if}
			</div>

			{#if subscription.isPro && periodEndLabel}
				<p class="mt-3 text-sm text-muted-foreground">
					Renews on {periodEndLabel}
				</p>
			{/if}

			<Separator class="my-5" />

			{#if subscription.isPro}
				<div class="flex items-center justify-between gap-4">
					<p class="text-sm text-muted-foreground">
						Change plan, update payment method, or cancel.
					</p>
					<Button
						onclick={async () => {
							const opened = await subscription.openBillingPortal();
							if (!opened) {
								rpc.notify.error.execute({
									title: 'Could not open billing portal',
									description: "Make sure you've subscribed before, then try again.",
								});
							}
						}}
						disabled={subscription.isPortalInFlight}
						variant="outline"
					>
						{#if subscription.isPortalInFlight}
							<Loader class="mr-2 size-4 animate-spin" />
							Opening…
						{:else}
							Manage billing
						{/if}
					</Button>
				</div>
			{:else}
				<div class="flex items-center justify-between gap-4">
					<p class="text-sm text-muted-foreground">
						Upgrade for unlimited cloud recordings, AI cleanup, and priority support.
					</p>
					<Button onclick={() => proPricingDialog.open()}>Get Pro</Button>
				</div>
			{/if}
		</div>
	{/if}
</div>
