<script lang="ts">
	// The NoteFlux ring as onboarding's recurring character: breathes while
	// idle, pings outward while the recorder is actually live, and settles
	// into a check once the user's words have landed.
	type Props = {
		state?: 'idle' | 'listening' | 'done';
		size?: number;
	};

	let { state = 'idle', size = 112 }: Props = $props();

	const gradientId = `ring-${Math.random().toString(36).slice(2, 9)}`;
</script>

<div class="voice-ring" data-state={state} style="--size: {size}px" aria-hidden="true">
	<span class="glow"></span>
	<span class="wave"></span>
	<span class="wave wave-2"></span>

	<svg viewBox="0 0 100 100" class="ring">
		<defs>
			<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="#4ade80" />
				<stop offset="100%" stop-color="#ecfdf5" />
			</linearGradient>
		</defs>
		<circle cx="50" cy="50" r="40" fill="none" stroke="url(#{gradientId})" stroke-width="7" />
	</svg>

	<div class="center">
		{#if state === 'listening'}
			<div class="bars">
				{#each [0, 1, 2, 3, 4] as i (i)}
					<span style="animation-delay: {i * 110}ms"></span>
				{/each}
			</div>
		{:else if state === 'done'}
			<svg viewBox="0 0 24 24" class="check">
				<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#86efac" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
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

	.ring {
		position: absolute;
		inset: 0;
		filter: drop-shadow(0 0 10px rgba(74, 222, 128, 0.55));
		animation: breathe 3.2s ease-in-out infinite;
	}

	.glow {
		position: absolute;
		inset: 12%;
		border-radius: 9999px;
		background: radial-gradient(circle, rgba(74, 222, 128, 0.28), transparent 70%);
		filter: blur(10px);
		animation: breathe 3.2s ease-in-out infinite;
	}

	.wave {
		position: absolute;
		inset: 10%;
		border-radius: 9999px;
		border: 2px solid rgba(74, 222, 128, 0.5);
		opacity: 0;
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
	}

	.bars span {
		width: 4px;
		height: 100%;
		border-radius: 9999px;
		background: #86efac;
		transform-origin: center;
		animation: bar 0.9s ease-in-out infinite;
	}

	.check {
		width: calc(var(--size) * 0.32);
		height: calc(var(--size) * 0.32);
		stroke-dasharray: 30;
		stroke-dashoffset: 30;
		animation: draw 0.5s 0.1s ease-out forwards;
	}

	[data-state='listening'] .ring {
		animation: breathe 0.9s ease-in-out infinite;
		filter: drop-shadow(0 0 18px rgba(74, 222, 128, 0.85));
	}

	[data-state='listening'] .wave {
		animation: wave 1.6s ease-out infinite;
	}

	[data-state='listening'] .wave-2 {
		animation-delay: 0.8s;
	}

	[data-state='done'] .wave {
		animation: wave 0.9s ease-out 1;
	}

	@keyframes breathe {
		0%,
		100% {
			transform: scale(1);
			opacity: 0.92;
		}
		50% {
			transform: scale(1.04);
			opacity: 1;
		}
	}

	@keyframes wave {
		0% {
			transform: scale(1);
			opacity: 0.7;
		}
		100% {
			transform: scale(1.9);
			opacity: 0;
		}
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
		.ring,
		.glow,
		.wave,
		.bars span {
			animation: none !important;
		}
		.check {
			stroke-dashoffset: 0;
			animation: none;
		}
	}
</style>
