<script lang="ts">
	import { mode } from 'mode-watcher';
	import {
		Toaster as Sonner,
		type ToasterProps as SonnerProps,
	} from 'svelte-sonner';
	import { cn } from '$lib/ui/utils/utils.js';

	let { class: className, ...restProps }: SonnerProps = $props();
</script>

<Sonner
	theme={mode.current}
	class={cn('toaster group !z-[100]', className)}
	style="--normal-bg: var(--color-popover); --normal-text: var(--color-popover-foreground); --normal-border: var(--color-border); --success-bg: var(--color-popover); --success-text: var(--color-success); --success-border: var(--color-border); --error-bg: var(--color-popover); --error-text: var(--color-destructive); --error-border: var(--color-border); --warning-bg: var(--color-popover); --warning-text: var(--color-foreground); --warning-border: var(--color-border); --info-bg: var(--color-popover); --info-text: var(--color-foreground); --info-border: var(--color-border);"
	{...restProps}
/>
