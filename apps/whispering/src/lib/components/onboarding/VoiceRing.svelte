<script lang="ts">
	import Orb from './Orb.svelte';
	import OrbFace from './OrbFace.svelte';

	// Same WebGL orb as the Welcome screen (identical props), just smaller —
	// the recurring character across all of onboarding, not a separate ring
	// design. Breathes while idle, "activates" (forced hover state) while
	// the recorder is actually live, and settles into a check once the
	// user's words have landed.
	type Props = {
		state?: 'idle' | 'listening' | 'done';
		size?: number;
	};

	let { state = 'idle', size = 112 }: Props = $props();
</script>

<div class="voice-ring" data-state={state} style="--size: {size}px" aria-hidden="true">
	<div class="orb-wrap">
		<Orb hoverIntensity={0.49} rotateOnHover={true} hue={100} forceHoverState={state === 'listening'} />
		{#if state === 'idle'}
			<OrbFace />
		{/if}
	</div>

	<div class="center">
		{#if state === 'listening'}
			<div class="bars">
				{#each [0, 1, 2, 3, 4] as i (i)}
					<span style="animation-delay: {i * 110}ms"></span>
				{/each}
			</div>
		{:else if state === 'done'}
			<svg viewBox="0 0 24 24" class="check">
				<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#f0fdf4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		{/if}
	</div>
</div>

<style>
	.voice-ring {
		position: relative;
		width: var(--size);
		height: var(--size);
		display: grid;
		place-items: center;
	}

	.orb-wrap {
		position: absolute;
		inset: 0;
	}

	.center {
		position: relative;
		display: grid;
		place-items: center;
	}

	.bars {
		display: flex;
		align-items: center;
		gap: 3px;
		height: calc(var(--size) * 0.3);
		filter: drop-shadow(0 0 4px rgba(187, 247, 208, 0.7));
	}

	.bars span {
		width: 4px;
		height: 100%;
		border-radius: 9999px;
		background: #f0fdf4;
		transform-origin: center;
		animation: bar 0.9s ease-in-out infinite;
	}

	.check {
		width: calc(var(--size) * 0.32);
		height: calc(var(--size) * 0.32);
		stroke-dasharray: 30;
		stroke-dashoffset: 30;
		filter: drop-shadow(0 0 4px rgba(187, 247, 208, 0.7));
		animation: draw 0.5s 0.1s ease-out forwards;
	}

	@keyframes bar {
		0%,
		100% {
			transform: scaleY(0.25);
		}
		50% {
			transform: scaleY(1);
		}
	}

	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.bars span {
			animation: none !important;
		}
		.check {
			stroke-dashoffset: 0;
			animation: none;
		}
	}
</style>
