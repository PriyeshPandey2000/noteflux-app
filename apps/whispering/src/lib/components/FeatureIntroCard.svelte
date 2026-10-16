<script lang="ts">
	import { cn } from '$lib/ui/utils';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import type { Component } from 'svelte';

	type Props = {
		variant: 'ask' | 'ocr';
		title: string;
		description: string;
		ctaLabel: string;
		icon: Component;
	};

	let { variant, title, description, ctaLabel, icon: Icon }: Props = $props();

	// One dominant, full-bleed accent color per card — bold rather than a
	// subtle bordered chip, so each feature reads as its own distinct block
	// at a glance (ask = violet, ocr = amber).
	const accent = {
		ask: 'bg-gradient-to-br from-violet-500 to-indigo-700',
		ocr: 'bg-gradient-to-br from-amber-400 to-orange-600',
	}[variant];
</script>

<div
	class={cn(
		'group flex w-72 flex-col gap-2 rounded-2xl p-4 text-left text-white shadow-lg transition-transform duration-200 hover:-translate-y-0.5',
		accent,
	)}
>
	<div class="flex items-center gap-2">
		<div class="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/20">
			<Icon class="size-4" />
		</div>
		<h3 class="text-sm font-semibold tracking-tight">{title}</h3>
	</div>
	<p class="text-xs leading-snug text-white/80">{description}</p>
	<span
		class="inline-flex w-fit cursor-pointer items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-black"
	>
		{ctaLabel}
		<ArrowRightIcon class="size-3 transition-transform group-hover:translate-x-0.5" />
	</span>
</div>
