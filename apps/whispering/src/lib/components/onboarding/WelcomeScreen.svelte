<script lang="ts">
	import { Button } from '$lib/ui/button';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import { onMount } from 'svelte';
	import Orb from './Orb.svelte';
	import OrbFace from './OrbFace.svelte';

	type Props = {
		onNext: () => void;
	};

	let { onNext }: Props = $props();

	const EXAMPLES = [
		{ app: 'Slack', text: 'sounds good, pushing the fix tonight 🚀' },
		{ app: 'Mail', text: 'Hi Sam, Thursday at 3 works for me.' },
		{ app: 'Notes', text: 'oat milk, call mom, book the flights' },
		{ app: 'Cursor', text: 'retry the request twice before failing' },
	];

	let orbHovered = $state(false);
	let exampleIndex = $state(0);
	let wordsShown = $state(0);
	const words = $derived(EXAMPLES[exampleIndex].text.split(' '));

	onMount(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			wordsShown = words.length;
			return;
		}
		let holdTicks = 0;
		const timer = setInterval(() => {
			if (wordsShown < words.length) {
				wordsShown++;
				return;
			}
			holdTicks++;
			if (holdTicks > 14) {
				holdTicks = 0;
				wordsShown = 0;
				exampleIndex = (exampleIndex + 1) % EXAMPLES.length;
			}
		}, 120);
		return () => clearInterval(timer);
	});
</script>

<div class="relative flex flex-col items-center text-center px-8 pt-6 pb-8 space-y-6 overflow-hidden">
	<div
		class="relative w-36 h-36 -mb-2"
		role="presentation"
		onpointerenter={() => (orbHovered = true)}
		onpointerleave={() => (orbHovered = false)}
	>
		<Orb hoverIntensity={0.49} rotateOnHover={true} hue={100} forceHoverState={false} />
		<OrbFace happy={orbHovered} />
	</div>

	<div class="space-y-2">
		<h1 class="text-[28px] leading-tight font-semibold tracking-tight text-white">
			Stop typing.<br />
			<span class="bg-gradient-to-r from-green-300 via-emerald-400 to-green-200 bg-clip-text text-transparent">
				Start talking.
			</span>
		</h1>
		<p class="text-sm text-white/55 max-w-[300px] mx-auto">
			Hold one key, say it, and it's typed wherever your cursor is. Any app.
		</p>
	</div>

	<!-- Live "it types for you" demo -->
	<div class="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left">
		<div class="flex items-center gap-2 mb-1.5">
			<span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
			<span class="text-[10px] uppercase tracking-wider text-white/35 font-medium">
				Typing into {EXAMPLES[exampleIndex].app}
			</span>
		</div>
		<p class="text-sm text-white/85 min-h-[20px]">
			{words.slice(0, wordsShown).join(' ')}<span class="caret"></span>
		</p>
	</div>

	<div class="w-full space-y-2">
		<Button onclick={onNext} class="w-full h-11 text-base font-medium cursor-pointer group">
			Let's go
			<ArrowRightIcon class="w-4 h-4 ml-1.5 transition-transform group-hover:translate-x-0.5" />
		</Button>
		<p class="text-[11px] text-white/35">Takes about a minute</p>
	</div>
</div>

<style>
	.caret {
		display: inline-block;
		width: 2px;
		height: 1em;
		margin-left: 2px;
		vertical-align: -2px;
		background: #4ade80;
		animation: blink 1s steps(1) infinite;
	}

	@keyframes blink {
		50% {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.caret {
			animation: none;
		}
	}
</style>
