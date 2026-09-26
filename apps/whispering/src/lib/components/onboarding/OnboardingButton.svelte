<script lang="ts">
	import { Button, type ButtonProps } from '$lib/ui/button';
	import { cn } from '$lib/ui/utils';

	let { class: className, children, ...restProps }: ButtonProps = $props();
</script>

<!--
	The default Button variant is near-white — reads as a generic, unstyled
	system button against onboarding's dark/green theme (VoiceRing, the Pro
	card's conic-gradient border, the progress rail all use the same green).
	This is the one shared "advance to next step" CTA used across
	Welcome/UsageGuide/InlineEdit/ChoiceScreen so the fix lives in one place
	instead of a repeated className on every call site.
-->
<Button
	class={cn(
		'bg-gradient-to-r from-green-500 to-emerald-400 text-zinc-950 font-semibold',
		'shadow-[0_0_24px_rgba(74,222,128,0.25)]',
		'hover:from-green-400 hover:to-emerald-300 hover:shadow-[0_0_32px_rgba(74,222,128,0.35)]',
		'transition-[filter,box-shadow]',
		// Base Button's default focus ring is a thick, theme-gray 3px ring —
		// clashes against this gradient and reads as an oversized border
		// (dialogs auto-focus the first button, so it's visible on load,
		// not just after a click). Thinner + color-matched instead of gray.
		'focus-visible:ring-2 focus-visible:ring-emerald-300/60 focus-visible:border-emerald-300/60',
		className,
	)}
	{...restProps}
>
	{@render children?.()}
</Button>
