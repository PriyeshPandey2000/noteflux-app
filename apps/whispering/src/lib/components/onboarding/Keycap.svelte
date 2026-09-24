<script lang="ts">
	// A chunky keycap that demonstrates "hold this" by pressing itself in a
	// loop, and stays pressed + glowing while the recorder is actually live.
	type Props = {
		label: string;
		demo?: boolean;
		active?: boolean;
	};

	let { label, demo = false, active = false }: Props = $props();

	const display = $derived(
		label === 'Option'
			? '⌥'
			: label === 'Space'
				? 'space'
				: label === 'Command'
					? '⌘'
					: label === 'Shift'
						? '⇧'
						: label,
	);
</script>

<span class="keycap" class:demo={demo && !active} class:active>
	{display}
</span>

<style>
	.keycap {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 3rem;
		height: 2.75rem;
		padding: 0 0.9rem;
		font-size: 0.95rem;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.9);
		background: linear-gradient(180deg, #3f3f46, #27272a);
		border: 1px solid #52525b;
		border-radius: 0.6rem;
		box-shadow:
			0 4px 0 #18181b,
			0 6px 14px rgba(0, 0, 0, 0.45);
		transition:
			transform 120ms ease,
			box-shadow 120ms ease,
			color 200ms ease;
	}

	.demo {
		animation: press 2.2s ease-in-out infinite;
	}

	.active {
		transform: translateY(4px);
		color: #bbf7d0;
		border-color: rgba(74, 222, 128, 0.6);
		box-shadow:
			0 0 0 #18181b,
			0 0 22px rgba(74, 222, 128, 0.55);
	}

	@keyframes press {
		0%,
		30%,
		100% {
			transform: translateY(0);
			box-shadow:
				0 4px 0 #18181b,
				0 6px 14px rgba(0, 0, 0, 0.45);
		}
		38%,
		72% {
			transform: translateY(4px);
			box-shadow:
				0 0 0 #18181b,
				0 0 18px rgba(74, 222, 128, 0.35);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.demo {
			animation: none;
		}
	}
</style>
