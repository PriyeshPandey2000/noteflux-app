<script lang="ts">
	let { class: className }: { class?: string } = $props();

	const bars = [
		{ delay: '0ms', duration: '750ms' },
		{ delay: '160ms', duration: '900ms' },
		{ delay: '80ms', duration: '650ms' },
		{ delay: '240ms', duration: '850ms' },
	];
</script>

<span class={className} style="display: inline-flex; align-items: center; gap: 2.5px; height: 1em;">
	{#each bars as bar}
		<span
			style="width: 2.5px; height: 100%; border-radius: 999px; background: currentColor; animation: recording-wave-bar {bar.duration} ease-in-out {bar.delay} infinite;"
		></span>
	{/each}
</span>

<style>
	@keyframes -global-recording-wave-bar {
		0%,
		100% {
			transform: scaleY(0.35);
			opacity: 0.7;
		}
		50% {
			transform: scaleY(1);
			opacity: 1;
		}
	}
</style>
