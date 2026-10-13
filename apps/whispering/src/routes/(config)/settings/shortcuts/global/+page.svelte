<script lang="ts">
	import { page } from '$app/stores';
	import { rpc } from '$lib/query';
	import * as services from '$lib/services';
	import { settings } from '$lib/stores/settings.svelte';
	import * as Alert from '$lib/ui/alert';
	import { Button } from '$lib/ui/button';
	import { Separator } from '$lib/ui/separator';
	import * as ToggleGroup from '$lib/ui/toggle-group';
	import { Layers2Icon, RotateCcw, LoaderCircle } from '@lucide/svelte';
	import { onDestroy, onMount } from 'svelte';

	import ShortcutFormatHelp from '../keyboard-shortcut-recorder/ShortcutFormatHelp.svelte';
	import ShortcutTable from '../keyboard-shortcut-recorder/ShortcutTable.svelte';
	import { syncGlobalShortcutsWithSettings } from '../../../../+layout/register-commands';

	// Check if Fn manager is currently initializing
	let isFnInitializing = $state(false);
	let checkInterval: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		// Check initialization status periodically
		isFnInitializing = services.permissionMonitor.isInitializing;
		checkInterval = setInterval(() => {
			isFnInitializing = services.permissionMonitor.isInitializing;
		}, 500);
	});

	// Force hide recording overlay with timeout to prevent hanging
	function hideOverlayNonBlocking() {
		if (window.__TAURI_INTERNALS__) {
			// Fire and forget with timeout - don't block the UI
			Promise.race([
				(async () => {
					try {
						const { invoke } = await import('@tauri-apps/api/core');
						await invoke('hide_recording_overlay');
					} catch (error) {
						// Silently fail
					}
				})(),
				new Promise((resolve) => setTimeout(resolve, 100)) // 100ms timeout
			]).catch(() => {
				// Ignore all errors
			});
		}
	}

	// Use $effect to ensure body styles are reset on every page load/navigation
	// By depending on $page, this effect runs every time we navigate to this route
	$effect(() => {
		// Access $page to create a reactive dependency on navigation
		$page.url;

		// Reset body styles immediately when this page is active
		if (typeof document !== 'undefined') {
			document.body.style.overflow = '';
			document.body.style.pointerEvents = '';
			document.documentElement.style.overflow = '';
		}
	});

	onMount(() => {
		// Non-blocking cleanup
		hideOverlayNonBlocking();
	});

	onDestroy(() => {
		hideOverlayNonBlocking();
		if (checkInterval) {
			clearInterval(checkInterval);
		}
	});
</script>

<svelte:head>
	<title>Global Shortcuts - NoteFlux</title>
</svelte:head>

{#if window.__TAURI_INTERNALS__}
	<section>
		<div
			class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
		>
			<header class="space-y-1">
				<div class="flex items-center gap-2">
					<h2 class="text-xl font-semibold tracking-tight sm:text-2xl">
						Global Shortcuts
					</h2>
					<ShortcutFormatHelp type="global" />
				</div>
				<p class="text-sm text-muted-foreground">
					Set system-wide keyboard shortcuts that work even when NoteFlux is
					not in focus. These shortcuts will trigger from anywhere on your
					system.
				</p>
			</header>
			<Button
				variant="outline"
				size="sm"
				onclick={() => {
					settings.resetShortcuts('global');
					rpc.notify.success.execute({
						title: 'Shortcuts reset',
						description: 'All global shortcuts have been reset to defaults.',
					});
				}}
				class="shrink-0"
			>
				<RotateCcw class="mr-2 size-4" />
				Reset to defaults
			</Button>
		</div>

		<Separator class="my-6" />

		{#if isFnInitializing}
			<Alert.Root variant="default" class="mb-6 border-blue-200 bg-blue-50">
				<LoaderCircle class="size-4 animate-spin text-blue-600" />
				<Alert.Description class="text-blue-800">
					Initializing Fn key support... This usually takes less than a second.
				</Alert.Description>
			</Alert.Root>
		{/if}

		<!-- Recording Mode Toggle -->
		<div class="mb-6 space-y-3">
			<div class="space-y-1">
				<h3 class="text-sm font-medium">Recording Mode</h3>
				<p class="text-sm text-muted-foreground">
					Choose how you want to control recording with keyboard shortcuts.
				</p>
			</div>
			<ToggleGroup.Root
				type="single"
				value={settings.value['shortcuts.recordingMode']}
				onValueChange={async (value) => {
					if (value) {
						settings.updateKey('shortcuts.recordingMode', value as 'hold' | 'toggle');
						// Re-sync shortcuts to activate the selected mode
						await syncGlobalShortcutsWithSettings();
					}
				}}
				class="justify-start grid grid-cols-1 sm:grid-cols-2 gap-3 w-full"
			>
				<ToggleGroup.Item
					value="hold"
					aria-label="Hold to record"
					class="flex-col h-auto py-3 px-4 gap-1 cursor-pointer data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
				>
					<span class="font-medium">Push to Talk</span>
					<span class="text-xs font-normal opacity-80">Hold key, speak, release to transcribe</span>
				</ToggleGroup.Item>
				<ToggleGroup.Item
					value="toggle"
					aria-label="Press to toggle"
					class="flex-col h-auto py-3 px-4 gap-1 cursor-pointer data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
				>
					<span class="font-medium">Toggle Mode</span>
					<span class="text-xs font-normal opacity-80">Press to start, press again to stop</span>
				</ToggleGroup.Item>
			</ToggleGroup.Root>
		</div>

		<ShortcutTable type="global" />
	</section>
{:else}
	<div class="rounded-lg border bg-card text-card-foreground shadow-sm">
		<div class="flex flex-col items-center justify-center p-8 text-center">
			<Layers2Icon class="mb-4 size-10 text-muted-foreground" />
			<h3 class="mb-2 text-xl font-medium">Global Shortcuts</h3>
			<p class="mb-6 max-w-md text-sm text-muted-foreground">
				Global shortcuts allow you to use NoteFlux from any application on
				your computer. This feature is only available in the desktop app or
				browser extension.
			</p>
			<Button href="/desktop-app" variant="default">
				Enable Global Shortcuts
			</Button>
		</div>
	</div>
{/if}
