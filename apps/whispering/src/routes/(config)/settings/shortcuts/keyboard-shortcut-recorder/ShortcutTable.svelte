<script lang="ts">
	import { commands } from '$lib/commands';
	import { rpc } from '$lib/query';
	import { getDefaultSettings } from '$lib/settings';
	import { settings } from '$lib/stores/settings.svelte';
	import { Input } from '$lib/ui/input';
	import * as Table from '$lib/ui/table';
	import { createPressedKeys } from '$lib/utils/createPressedKeys.svelte';
	import { Search } from '@lucide/svelte';

	import GlobalKeyboardShortcutRecorder from './GlobalKeyboardShortcutRecorder.svelte';
	import LocalKeyboardShortcutRecorder from './LocalKeyboardShortcutRecorder.svelte';

	let { type }: { type: 'global' | 'local' } = $props();

	let searchQuery = $state('');

	const defaultSettings = getDefaultSettings();

	const filteredCommands = $derived(
		commands.filter((command) =>
			command.title.toLowerCase().includes(searchQuery.toLowerCase()),
		),
	);

	const pressedKeys = createPressedKeys({
		onUnsupportedKey: (key) => {
			rpc.notify.warning.execute({
				title: 'Unsupported key',
				description: `The key "${key}" is not supported. Please try a different key.`,
			});
		},
	});

	// Determine if a command should be disabled based on recording mode
	function isCommandDisabled(commandId: string): boolean {
		const recordingMode = settings.value['shortcuts.recordingMode'];

		// Disable pushToTalk when in toggle mode
		if (commandId === 'pushToTalk' && recordingMode === 'toggle') {
			return true;
		}

		// Disable toggleManualRecording when in hold mode
		if (commandId === 'toggleManualRecording' && recordingMode === 'hold') {
			return true;
		}

		return false;
	}
</script>

<div class="space-y-4">
	<!-- Search input: commented out until we have enough commands to warrant it -->
	<!-- <div class="relative">
		<Search
			class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
		/>
		<Input
			type="search"
			placeholder="Search commands..."
			class="pl-10"
			bind:value={searchQuery}
		/>
	</div> -->

	<!-- Command list with shortcuts -->
	<div class="overflow-x-auto rounded-lg border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head class="min-w-[150px]">Command</Table.Head>
					<Table.Head class="text-right min-w-[200px]">Shortcut</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each filteredCommands as command}
					{@const defaultShortcut =
						defaultSettings[`shortcuts.${type}.${command.id}`]}
					{@const disabled = isCommandDisabled(command.id)}
					<Table.Row class={disabled ? 'opacity-40' : ''}>
						<Table.Cell class="font-medium">
							<span class="block truncate pr-2">
								{command.title}
								{#if disabled}
									<span class="ml-2 text-xs text-muted-foreground">(Disabled in current mode)</span>
								{/if}
							</span>
						</Table.Cell>
						<Table.Cell class="text-right">
							{#if type === 'local'}
								<LocalKeyboardShortcutRecorder
									{command}
									placeholder={defaultShortcut
										? `Default: ${defaultShortcut}`
										: 'Set shortcut'}
									{pressedKeys}
									{disabled}
								/>
							{:else}
								<GlobalKeyboardShortcutRecorder
									{command}
									placeholder={defaultShortcut
										? `Default: ${defaultShortcut}`
										: 'Set shortcut'}
									{pressedKeys}
									{disabled}
								/>
							{/if}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>
