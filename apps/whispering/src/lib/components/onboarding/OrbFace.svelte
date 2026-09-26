<script lang="ts">
	import { onMount } from 'svelte';

	// Overlay face for the WebGL Orb. pointer-events: none so the orb canvas
	// underneath still gets hover (its rotate-on-hover effect); the parent
	// passes `happy` from its own hover tracking instead.
	type Props = {
		happy?: boolean;
	};

	let { happy = false }: Props = $props();

	let container = $state<HTMLDivElement | null>(null);
	let lookX = $state(0);
	let lookY = $state(0);

	onMount(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		const onMove = (event: PointerEvent) => {
			if (!container) return;
			const rect = container.getBoundingClientRect();
			const dx = event.clientX - (rect.left + rect.width / 2);
			const dy = event.clientY - (rect.top + rect.height / 2);
			const distance = Math.hypot(dx, dy) || 1;
			// Hits full reach within ~60px of the orb so small moves register.
			const reach = Math.min(5, distance / 12);
			lookX = (dx / distance) * reach;
			lookY = (dy / distance) * reach;
		};

		window.addEventListener('pointermove', onMove);
		return () => window.removeEventListener('pointermove', onMove);
	});
</script>

<div bind:this={container} class="face" aria-hidden="true">
	<svg viewBox="0 0 60 40">
		{#if happy}
			<g class="features">
				<path d="M15 15 Q20 9 25 15" class="line" />
				<path d="M35 15 Q40 9 45 15" class="line" />
				<path d="M20 25 Q30 35 40 25" class="line" />
			</g>
		{:else}
			<g class="features" style="transform: translate({lookX}px, {lookY}px)">
				<ellipse class="eye eye-left" cx="20" cy="14" rx="3.6" ry="5" />
				<ellipse class="eye eye-right" cx="40" cy="14" rx="3.6" ry="5" />
			</g>
			<!-- Mouth follows at half strength — gives the face a bit of depth. -->
			<g class="features" style="transform: translate({lookX * 0.5}px, {lookY * 0.5}px)">
				<path d="M23 26 Q30 31.5 37 26" class="line" />
			</g>
		{/if}
	</svg>
</div>

<style>
	.face {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
	}

	svg {
		width: 54%;
		overflow: visible;
		filter: drop-shadow(0 0 4px rgba(187, 247, 208, 0.7));
	}

	.features {
		transition: transform 60ms linear;
	}

	.eye {
		fill: #f0fdf4;
		transform-box: fill-box;
		transform-origin: center;
	}

	.line {
		fill: none;
		stroke: #f0fdf4;
		stroke-width: 2.6;
		stroke-linecap: round;
	}

	/* Both eyes blink together every 4.5s; the right eye's 9s cycle repeats
	   those same two blinks and adds a slower wink in between. */
	.eye-left {
		animation: blink 4.5s infinite;
	}

	.eye-right {
		animation: blink-and-wink 9s infinite;
	}

	@keyframes blink {
		0%,
		94%,
		100% {
			transform: scaleY(1);
		}
		97% {
			transform: scaleY(0.1);
		}
	}

	@keyframes blink-and-wink {
		0%,
		47%,
		50%,
		68%,
		76%,
		97%,
		100% {
			transform: scaleY(1);
		}
		48.5%,
		98.5% {
			transform: scaleY(0.1);
		}
		70%,
		74% {
			transform: scaleY(0.08);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.eye-left,
		.eye-right {
			animation: none;
		}
	}
</style>
