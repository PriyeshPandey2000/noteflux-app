<script lang="ts">
	import type { KeyboardEventSupportedKey } from '$lib/constants/keyboard';

	import { IS_MACOS } from '$lib/constants/platform';
	import * as Alert from '$lib/ui/alert';
	import { Badge } from '$lib/ui/badge';
	import { Button } from '$lib/ui/button';
	import * as Dialog from '$lib/ui/dialog';
	import { Input } from '$lib/ui/input';
	import { cn } from '$lib/ui/utils';
	import { AlertTriangle, CheckCircle, Keyboard, Lightbulb, Pencil, XIcon } from '@lucide/svelte';

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
	let isManualMode = $state(false);
	let manualValue = $state(rawKeyCombination ?? '');
	let saveStatus = $state<'none' | 'saving' | 'saved' | 'error'>('none');

	$effect(() => {
		manualValue = rawKeyCombination ?? '';
	});

	async function resetDialog() {
		isManualMode = false;
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

	function handleManualSave() {
		if (manualValue) {
			saveStatus = 'saving';
			// Properly parse manual input by trimming spaces and normalizing
			const keys = manualValue
				.split('+')
				.map(key => {
					const trimmed = key.trim();
					// Preserve "Fn" capitalization, lowercase everything else
					return trimmed.toLowerCase() === 'fn' ? 'Fn' : trimmed.toLowerCase();
				})
				.filter(key => key.length > 0);
			keyRecorder.register(keys as KeyboardEventSupportedKey[]);
			saveStatus = 'saved';
			setTimeout(() => {
				isDialogOpen = false;
				resetDialog();
			}, 1500);
		}
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
			onPointerDownOutside={(e) => {
				// Prevent closing only when actively recording
				if (keyRecorder.isListening) {
					e.preventDefault();
				}
			}}
			onEscapeKeyDown={(e) => {
				// Allow escape key to close even when testing
				isDialogOpen = false;
			}}
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
					<p class="mb-3 text-sm text-muted-foreground">Once your shortcut is registered correctly, it will appear in the "Current" section below. Then press that shortcut to test if you see the recording overlay.</p>
					<div class="mb-3 text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg p-2">
						<p class="flex items-center gap-1.5 font-medium"><Lightbulb class="size-4" /> Recording Tips:</p>
						<p>• Click "Record by pressing keys" below → Press the letter FIRST, then hold modifier keys (Cmd/Ctrl/Option)</p>
						<p>• For Fn key shortcuts: Use the "Type manually" option below and enter "Fn" or "Fn+A", etc.</p>
						<p>• Same shortcut will both START and STOP recording</p>
						<p>• Once set: Press your shortcut to test → Look for recording overlay → If you see it, shortcut works!</p>
					</div>
					
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
							<div class="rounded-lg border bg-muted/50 p-3 flex flex-col items-center justify-center min-w-[120px]">
								<span class="text-xs font-medium text-muted-foreground mb-1">Current:</span>
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

				<!-- Advanced: Manual Entry -->
				<div class="border-t pt-4">
					<div class="mb-3 flex items-center justify-between">
						<div>
							<h4 class="text-sm font-medium text-muted-foreground">Advanced: Type manually</h4>
							<p class="text-xs text-muted-foreground">For Fn key shortcuts or complex combinations that don't record properly</p>
						</div>
						{#if !isManualMode}
							<Button
								variant="outline"
								size="sm"
								onclick={() => {
									isManualMode = true;
									manualValue = rawKeyCombination ?? '';
								}}
							>
								<Pencil class="mr-2 size-3" />
								Type custom
							</Button>
						{/if}
					</div>

					{#if isManualMode}
						<div class="space-y-3">
							<Input
								type="text"
								placeholder="e.g., Fn, Fn+A, ctrl+shift+r, cmd+option+t"
								bind:value={manualValue}
								class="font-mono"
								autofocus
							/>
							<div class="flex gap-2">
								<Button
									variant="outline"
									size="sm"
									onclick={() => {
										isManualMode = false;
										manualValue = rawKeyCombination ?? '';
									}}
								>
									Cancel
								</Button>
								<Button
									size="sm"
									onclick={handleManualSave}
									disabled={!manualValue || saveStatus === 'saving'}
								>
									{saveStatus === 'saving' ? 'Saving...' : 'Save'}
								</Button>
							</div>
						</div>
					{/if}
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