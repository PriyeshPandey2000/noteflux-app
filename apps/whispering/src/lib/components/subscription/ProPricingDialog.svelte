<script lang="ts">
	import * as Dialog from '$lib/ui/dialog';
	import { proPricingDialog } from '$lib/stores/pro-pricing-dialog.svelte';
	import { subscription } from '$lib/stores/subscription.svelte';
	import { cn } from '$lib/ui/utils';
	import { CheckIcon, Loader, ZapIcon } from '@lucide/svelte';

	type Billing = 'monthly' | 'yearly';
	let billing = $state<Billing>('monthly');

	const FREE_FEATURES = [
		'Voice-to-text in any app',
		'Local models, free forever',
		'Instant correction & formatting',
		'Community support',
	];

	const PRO_FEATURES = [
		'Unlimited voice recordings',
		'AI-powered transcription & style control',
		'Priority support',
		'Early access to new features',
	];

	async function handleGetPro() {
		await subscription.openCheckout(billing);
		proPricingDialog.close();
	}
</script>

<Dialog.Root bind:open={proPricingDialog.isOpen}>
	<Dialog.Content class="max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Upgrade to Pro</Dialog.Title>
			<Dialog.Description>Start free. Upgrade when you need more.</Dialog.Description>
		</Dialog.Header>

		<div class="flex justify-center py-2">
			<div class="inline-flex items-center rounded-full border p-1">
				<button
					type="button"
					onclick={() => (billing = 'monthly')}
					class={cn(
						'rounded-full px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer',
						billing === 'monthly'
							? 'bg-foreground text-background'
							: 'text-muted-foreground hover:text-foreground'
					)}
				>
					Monthly
				</button>
				<button
					type="button"
					onclick={() => (billing = 'yearly')}
					class={cn(
						'flex items-center rounded-full px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer',
						billing === 'yearly'
							? 'bg-foreground text-background'
							: 'text-muted-foreground hover:text-foreground'
					)}
				>
					Yearly
					<span class="ml-1.5 text-emerald-500">2 months free</span>
				</button>
			</div>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<!-- Starter -->
			<div class="rounded-2xl border p-5">
				<h3 class="text-lg font-bold">Starter</h3>
				<p class="text-sm text-muted-foreground">Your current plan</p>

				<div class="mt-4 flex items-baseline gap-1.5">
					<span class="text-3xl font-bold">$0</span>
					<span class="text-sm text-muted-foreground">/ month</span>
				</div>

				<ul class="mt-5 space-y-3">
					{#each FREE_FEATURES as feature (feature)}
						<li class="flex items-center gap-2.5 border-t pt-3 text-sm">
							<CheckIcon class="size-4 shrink-0 text-muted-foreground" />
							{feature}
						</li>
					{/each}
				</ul>
			</div>

			<!-- Pro -->
			<div
				class="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.03] p-5"
			>
				<div
					class="pointer-events-none absolute inset-0"
					style="background: radial-gradient(120% 100% at 50% 100%, rgba(34,197,94,0.18) 0%, rgba(34,197,94,0.06) 45%, transparent 75%);"
				></div>

				<div class="relative">
					<h3
						class="text-lg font-bold bg-gradient-to-r from-green-400 via-green-500 to-emerald-400 bg-clip-text text-transparent"
					>
						Pro
					</h3>
					<p class="text-sm text-muted-foreground">For power users</p>

					<div class="mt-4 flex items-baseline gap-1.5">
						<span class="text-3xl font-bold">{billing === 'monthly' ? '$7' : '$72'}</span>
						<span class="text-sm text-muted-foreground">{billing === 'monthly' ? '/ month' : '/ year'}</span>
					</div>
					{#if billing === 'yearly'}
						<p class="text-xs text-muted-foreground">billed $6/month</p>
					{/if}

					<ul class="mt-5 space-y-3">
						{#each PRO_FEATURES as feature (feature)}
							<li class="flex items-center gap-2.5 border-t border-emerald-500/20 pt-3 text-sm">
								<CheckIcon class="size-4 shrink-0 text-emerald-400" />
								{feature}
							</li>
						{/each}
					</ul>

					<button
						type="button"
						onclick={handleGetPro}
						disabled={subscription.isCheckoutInFlight}
						class={cn(
							'mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 cursor-pointer',
							subscription.isCheckoutInFlight && 'opacity-50 cursor-default'
						)}
					>
						{#if subscription.isCheckoutInFlight}
							<Loader class="size-4 animate-spin" />
							Opening checkout…
						{:else}
							<ZapIcon class="size-4" />
							Get Pro
						{/if}
					</button>
				</div>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
