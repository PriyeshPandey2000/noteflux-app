<script lang="ts">
	import type { KeyboardEventSupportedKey } from '$lib/constants/keyboard';

	import Keycap from '$lib/components/onboarding/Keycap.svelte';
	import { IS_MACOS } from '$lib/constants/platform';
	import * as Alert from '$lib/ui/alert';
	import { Badge } from '$lib/ui/badge';
	import { Button } from '$lib/ui/button';
	import * as Dialog from '$lib/ui/dialog';
	import { keyToLabel } from '$lib/utils/key-label';
	import { CheckCircle, Keyboard, XIcon } from '@lucide/svelte';

	import { type KeyRecorder } from './create-key-recorder.svelte';

	const {
		title,
		autoFocus = true,
		keyRecorder,
		placeholder = 'Press a key combination',
		rawKeyCombination,
		onDialogClose,
		disabled = false,
	}: {
		autoFocus?: boolean;
		keyRecorder: KeyRecorder;
		placeholder?: string;
		rawKeyCombination: null | string;
		title: string;
		onDialogClose?: () => void;
		disabled?: boolean;
	} = $props();

	let isDialogOpen = $state(false);
	let saveStatus = $state<'none' | 'saving' | 'saved' | 'error'>('none');

	let lastRawCombination = $state(rawKeyCombination);
	$effect(() => {
		if (rawKeyCombination !== lastRawCombination) {
			lastRawCombination = rawKeyCombination;
			if (rawKeyCombination) saveStatus = 'saved';
		}
	});

	async function resetDialog() {
		saveStatus = 'none';
		keyRecorder.stop(); // Force stop any active recording

		// Force hide recording overlay if it's stuck
		if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
			try {
				const { invoke } = await import('@tauri-apps/api/core');
				await invoke('hide_recording_overlay');
			} catch (error) {
				// Silently fail if overlay is not visible
			}
		}
	}

	function handlePresetShortcut(keys: KeyboardEventSupportedKey[]) {
		saveStatus = 'saving';
		keyRecorder.register(keys);
		saveStatus = 'saved';
		// Dialog stays open - user must click Done/Cancel to close
	}

</script>

<div class="flex items-center justify-end gap-2">
	{#if rawKeyCombination}
		<Badge variant="secondary" class="font-mono text-xs">
			{rawKeyCombination}
		</Badge>
		<Button
			variant="ghost"
			size="icon"
			class="size-8 shrink-0"
			onclick={() => {
				keyRecorder.clear();
				saveStatus = 'none';
			}}
			{disabled}
		>
			<XIcon class="size-4" />
			<span class="sr-only">Clear shortcut</span>
		</Button>
	{:else}
		<span class="text-sm text-muted-foreground">Not set</span>
	{/if}

	<Dialog.Root
		open={isDialogOpen && !disabled}
		onOpenChange={(open) => {
			if (disabled) return;
			// Prevent closing if we're in recording mode
			if (!open && keyRecorder.isListening) {
				return;
			}
			isDialogOpen = open;
			if (!open) {
				resetDialog();
				onDialogClose?.();
			}
		}}
	>
		<Dialog.Trigger>
			<Button variant="ghost" size="sm" class="h-8 font-normal" {disabled}>
				{#if rawKeyCombination}
					<span class="text-xs">Change shortcut</span>
				{:else}
					<span class="text-xs text-muted-foreground">+ Add shortcut</span>
				{/if}
			</Button>
		</Dialog.Trigger>

		<Dialog.Content
			class="max-w-[90vw] sm:max-w-[90vw] z-[60]"
			escapeKeydownBehavior={keyRecorder.isListening ? 'ignore' : 'close'}
			interactOutsideBehavior={keyRecorder.isListening ? 'ignore' : 'close'}
		>
			<Dialog.Header>
				<Dialog.Title class="text-lg">{title}</Dialog.Title>
			</Dialog.Header>

			<div class="space-y-6 py-4">
				<!-- Save Status -->
				{#if saveStatus === 'saved'}
					<Alert.Root variant="default" class="border-green-200 bg-green-50">
						<CheckCircle class="size-4 text-green-600" />
						<Alert.Description class="text-green-800">
							Shortcut saved successfully!
						</Alert.Description>
					</Alert.Root>
				{/if}

				<!-- Main Method: Record Keys -->
				<div>
					<h4 class="mb-3 text-sm font-medium">Set Your Shortcut</h4>

					{#if keyRecorder.isListening}
						<div class="mb-3 flex min-h-[4.5rem] flex-wrap items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/40 p-4">
							{#if keyRecorder.captured.length === 0}
								<span class="text-sm text-muted-foreground">Press your shortcut…</span>
							{:else}
								{#each keyRecorder.captured as key, i (key)}
									<Keycap label={keyToLabel(key)} active />
									{#if i < keyRecorder.captured.length - 1}
										<span class="text-sm text-muted-foreground">+</span>
									{/if}
								{/each}
							{/if}
						</div>
						{#if keyRecorder.captured.length > 0 && keyRecorder.captured.every((k) => ['meta', 'alt', 'control', 'shift', 'altgraph', 'super'].includes(k))}
							<p class="mb-2 text-xs text-amber-600">Add a letter or number to complete the shortcut</p>
						{/if}
						<p class="mb-3 text-center text-xs text-muted-foreground">Press <strong>Esc</strong> to cancel</p>
					{/if}
					
					<div class="flex gap-4">
						<Button
							variant="outline"
							class="flex-1"
							onclick={() => keyRecorder.start()}
							disabled={keyRecorder.isListening || saveStatus === 'saving'}
						>
							<Keyboard class="mr-2 size-4" />
							{keyRecorder.isListening ? 'Press keys now...' : 'Record by pressing keys'}
						</Button>

						{#if rawKeyCombination}
							<div class="rounded-lg border p-3 flex flex-col items-center justify-center min-w-[120px] transition-colors {saveStatus === 'saved' ? 'border-green-300 bg-green-50' : 'bg-muted/50'}">
								<span class="text-xs font-medium mb-1 flex items-center gap-1 {saveStatus === 'saved' ? 'text-green-700' : 'text-muted-foreground'}">
									{#if saveStatus === 'saved'}<CheckCircle class="size-3" />{/if}
									Current:
								</span>
								<Badge variant="secondary" class="font-mono text-xs">
									{rawKeyCombination}
								</Badge>
								<p class="mt-2 text-xs text-muted-foreground text-center">
									Press <strong>{rawKeyCombination}</strong><br />
									<span class="text-xs opacity-75">Watch for recording indicator</span>
								</p>
							</div>
						{/if}
					</div>

				</div>

				<!-- Quick Presets -->
				<div>
					<h4 class="mb-3 text-sm font-medium">Or choose a common shortcut:</h4>
					<div class="grid grid-cols-2 gap-2">
						{#if IS_MACOS}
							<Button
								variant="outline"
								class="h-10 font-mono bg-blue-50 hover:bg-blue-100 border-blue-200"
								onclick={() => handlePresetShortcut(['fn'])}
								disabled={saveStatus === 'saving'}
							>
								{#if saveStatus === 'saving'}
									Saving...
								{:else}
									Fn (Globe key)
								{/if}
							</Button>
						{/if}
						<Button
							variant="outline"
							class="h-10 font-mono"
							onclick={() => handlePresetShortcut(['shift', 'z'])}
							disabled={saveStatus === 'saving'}
						>
							{#if saveStatus === 'saving'}
								Saving...
							{:else}
								Shift+Z
							{/if}
						</Button>
						<Button
							variant="outline"
							class="h-10 font-mono"
							onclick={() => handlePresetShortcut(['shift', 'x'])}
							disabled={saveStatus === 'saving'}
						>
							Shift+X
						</Button>
						<Button
							variant="outline"
							class="h-10 font-mono"
							onclick={() => handlePresetShortcut(['control', 'z'])}
							disabled={saveStatus === 'saving'}
						>
							Ctrl+Z
						</Button>
						<Button
							variant="outline"
							class="h-10 font-mono"
							onclick={() => handlePresetShortcut(['control', 'x'])}
							disabled={saveStatus === 'saving'}
						>
							Ctrl+X
						</Button>
					</div>
				</div>

			</div>

			<Dialog.Footer>
				<Button
					variant="outline"
					onclick={() => {
						isDialogOpen = false;
						resetDialog();
						onDialogClose?.();
					}}
				>
					{saveStatus === 'saved' ? 'Done' : 'Cancel'}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
</div>

<style>
	/* Override z-index for keyboard shortcut dialog to appear above header */
	:global([data-slot="dialog-overlay"]) {
		z-index: 60 !important;
	}
</style>