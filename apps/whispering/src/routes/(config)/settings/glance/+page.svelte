<script lang="ts">
	import { settings } from '$lib/stores/settings.svelte';
	import { Badge } from '$lib/ui/badge';
	import * as Card from '$lib/ui/card';
	import { Label } from '$lib/ui/label';
	import { Switch } from '$lib/ui/switch';

	function handleGlanceToggle(checked: boolean) {
		settings.updateKey('glance.enabled', checked);
	}
</script>

<div class="space-y-8">
	<!-- Page Header -->
	<div class="space-y-2">
		<div class="flex items-center gap-3">
			<h3 class="text-xl font-semibold tracking-tight">Glance</h3>
			{#if settings.value['glance.enabled']}
				<Badge variant="outline" class="text-xs text-green-700 dark:text-green-400 border-green-200 dark:border-green-400/30">
					Enabled
				</Badge>
			{:else}
				<Badge variant="outline" class="text-xs text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-400/30">
					Disabled
				</Badge>
			{/if}
		</div>
		<p class="text-sm text-muted-foreground max-w-2xl">
			Let NoteFlux see which app you're in so it can give better answers. Nothing is ever saved.
		</p>
	</div>

	<!-- Main Toggle Section -->
	<Card.Root class="transition-colors duration-200">
		<Card.Content>
			<div class="flex items-start justify-between gap-4">
				<div class="space-y-2 flex-1">
					<Label for="glance-toggle" class="text-base font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
						Use app context for better accuracy
					</Label>
					<p class="text-sm text-muted-foreground leading-relaxed">
						When you press Fn, NoteFlux checks which app is frontmost to tailor its response — for example, a more formal tone in Mail, code-aware output in an editor.
					</p>
				</div>
				<Switch
					id="glance-toggle"
					checked={settings.value['glance.enabled']}
					onCheckedChange={handleGlanceToggle}
					class="shrink-0"
				/>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Data Collection Information -->
	<div class="grid gap-4 md:grid-cols-2">
		<Card.Root class="border-green-100 dark:border-green-900/20">
			<Card.Header>
				<Card.Title class="text-sm font-medium text-green-700 dark:text-green-400 flex items-center gap-2">
					<div class="w-2 h-2 bg-green-500 rounded-full"></div>
					What we check
				</Card.Title>
			</Card.Header>
			<Card.Content>
				<ul class="text-sm text-muted-foreground space-y-1.5 leading-relaxed">
					<li class="flex items-start gap-2">
						<span class="text-green-500 mt-1">•</span>
						<span>The name of the app you're currently using</span>
					</li>
					<li class="flex items-start gap-2">
						<span class="text-green-500 mt-1">•</span>
						<span>Checked once, only when you press Fn</span>
					</li>
				</ul>
			</Card.Content>
		</Card.Root>

		<Card.Root class="border-amber-100 dark:border-amber-900/20">
			<Card.Header>
				<Card.Title class="text-sm font-medium text-amber-700 dark:text-amber-400 flex items-center gap-2">
					<div class="w-2 h-2 bg-amber-500 rounded-full"></div>
					Never saved
				</Card.Title>
			</Card.Header>
			<Card.Content>
				<ul class="text-sm text-muted-foreground space-y-1.5 leading-relaxed">
					<li class="flex items-start gap-2">
						<span class="text-amber-500 mt-1">•</span>
						<span>No screenshots or screen content are stored</span>
					</li>
					<li class="flex items-start gap-2">
						<span class="text-amber-500 mt-1">•</span>
						<span>Nothing is uploaded unless you're actively asking a question</span>
					</li>
					<li class="flex items-start gap-2">
						<span class="text-amber-500 mt-1">•</span>
						<span>Turned off entirely by default — this is opt-in only</span>
					</li>
				</ul>
			</Card.Content>
		</Card.Root>
	</div>

	<!-- Status Footer -->
	<div class="flex items-center gap-2 text-xs">
		{#if settings.value['glance.enabled']}
			<div class="flex items-center gap-2 text-green-700 dark:text-green-400">
				<div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
				<span class="font-medium">Glance active</span>
				<span class="text-muted-foreground">• Changes take effect immediately</span>
			</div>
		{:else}
			<div class="flex items-center gap-2 text-amber-700 dark:text-amber-400">
				<div class="w-2 h-2 bg-amber-500 rounded-full"></div>
				<span class="font-medium">Glance disabled</span>
				<span class="text-muted-foreground">• NoteFlux never checks which app you're in</span>
			</div>
		{/if}
	</div>
</div>
