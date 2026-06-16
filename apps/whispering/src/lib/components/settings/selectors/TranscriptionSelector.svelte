<script lang="ts">
	import { goto } from '$app/navigation';
	import NoteFluxButton from '$lib/components/NoteFluxButton.svelte';
	import {
		TRANSCRIPTION_SERVICES,
		type TranscriptionService,
	} from '$lib/constants/transcription';
	import {
		getSelectedTranscriptionService,
		isTranscriptionServiceConfigured,
	} from '$lib/settings/transcription-validation';
	import * as services from '$lib/services';
	import { settings } from '$lib/stores/settings.svelte';
	import { Badge } from '$lib/ui/badge';
	import * as Command from '$lib/ui/command';
	import { useCombobox } from '$lib/ui/hooks';
	import * as Popover from '$lib/ui/popover';
	import { cn } from '$lib/ui/utils';
	import {
		DEFAULT_QWEN3_ASR_MODEL_ID,
		QWEN3_ASR_MODELS,
		type Qwen3ASRModelId,
	} from '$lib/services/transcription/qwen3-asr';
	import { CheckIcon, DownloadIcon, MicIcon, SettingsIcon } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	let { class: className }: { class?: string } = $props();

	const selectedService = $derived(getSelectedTranscriptionService());

	// Local model checks — run once when dropdown opens.
	let isLocalModelDownloaded = $state(false);
	let isLocalModelSupported = $state(true);
	$effect(() => {
		if (combobox.open) {
			services.transcriptions.qwen3asr.isMacOSSupported().then((supported) => {
				isLocalModelSupported = supported;
				if (supported) {
					const selectedModelId = (settings.value['transcription.qwen3asr.modelId'] ??
						DEFAULT_QWEN3_ASR_MODEL_ID) as Qwen3ASRModelId;
					services.transcriptions.qwen3asr.getModelStatus(selectedModelId).then((status) => {
						isLocalModelDownloaded = status === 'downloaded';
					});
				}
			});
		}
	});

	function getSelectedModelNameOrUrl(service: TranscriptionService) {
		switch (service.type) {
			case 'api':
				return settings.value[service.modelSettingKey];
			case 'local':
				return 'on-device';
		}
	}

	const apiServices = $derived(
		TRANSCRIPTION_SERVICES.filter((service) => service.type === 'api'),
	);

	const localServices = $derived(
		TRANSCRIPTION_SERVICES.filter((service) => service.type === 'local'),
	);


	const combobox = useCombobox();
</script>

{#snippet renderServiceDisplay(service: TranscriptionService)}
	{@const Icon = service.icon}
	<div class="flex items-center gap-2">
		<Icon class="size-4 shrink-0" />
		<span class="font-medium truncate">
			{service.name}
		</span>
	</div>
{/snippet}

<Popover.Root bind:open={combobox.open}>
	<Popover.Trigger bind:ref={combobox.triggerRef}>
		{#snippet child({ props })}
			<NoteFluxButton
				{...props}
				class={cn('relative', className)}
				tooltipContent={selectedService
					? `Current transcription service: ${selectedService.name}(${getSelectedModelNameOrUrl(
							selectedService,
						)})`
					: 'Select a transcription service'}
				role="combobox"
				aria-expanded={combobox.open}
				variant="ghost"
				size="icon"
			>
				{#if selectedService}
					{@const SelectedIcon = selectedService.icon}
					<SelectedIcon
						class={cn(
							'size-4',
							isTranscriptionServiceConfigured(selectedService)
								? 'text-green-500'
								: 'text-amber-500',
						)}
					/>
				{:else}
					<MicIcon class="size-4 text-muted-foreground" />
				{/if}
				{#if selectedService && !isTranscriptionServiceConfigured(selectedService)}
					<span
						class="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber-500 before:absolute before:left-0 before:top-0 before:h-full before:w-full before:rounded-full before:bg-amber-500/50 before:animate-ping"
					></span>
				{/if}
			</NoteFluxButton>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-80 max-w-xl p-0">
		<Command.Root loop>
			<Command.Input placeholder="Select transcription service..." />
			<Command.List class="overflow-y-auto max-h-[400px]">
				<Command.Empty>No service found.</Command.Empty>

				{#each apiServices as service (service.id)}
					{@const isSelected =
						settings.value['transcription.selectedTranscriptionService'] ===
						service.id}
					{@const isConfigured = isTranscriptionServiceConfigured(service)}
					{@const currentSelectedModelName = getSelectedModelNameOrUrl(service)}

					<Command.Group heading={service.name}>
						{#each service.models as model}
							{@const isModelSelected =
								isSelected && currentSelectedModelName === model.name}
							{@const Icon = service.icon}
							<Command.Item
								value="{service.id}-{model.name}"
								onSelect={() => {
									settings.update({
										[service.modelSettingKey]: model.name,
										'transcription.selectedTranscriptionService': service.id,
									});
									combobox.closeAndFocusTrigger();
								}}
								class="flex items-center gap-2 p-2"
							>
								<CheckIcon
									class={cn('size-4 shrink-0 ml-2', {
										'text-transparent': !isModelSelected,
									})}
								/>
								<div class="flex flex-col min-w-0">
									<div class="flex items-center gap-2">
										<Icon class="size-4 shrink-0" />
										<span class="font-medium">{model.name}</span>
									</div>
									{#if !isConfigured}
										<!-- <span class="text-sm text-amber-600 ml-6"
											>API key required</span> -->
									{/if}
								</div>
							</Command.Item>
						{/each}
					</Command.Group>
				{/each}


{#each localServices as service (service.id)}
					{@const isSelected =
						settings.value['transcription.selectedTranscriptionService'] ===
						service.id}

					<Command.Group heading="On-Device">
						<Command.Item
							value={service.id}
							onSelect={() => {
								if (!isLocalModelSupported) {
									toast.error('macOS 15 required', {
										description: 'Qwen3-ASR requires macOS 15 (Sequoia) or later.',
									});
									combobox.closeAndFocusTrigger();
									return;
								}
								if (!isLocalModelDownloaded) {
									settings.updateKey('transcription.selectedTranscriptionService', service.id);
									goto('/settings/transcription');
									combobox.closeAndFocusTrigger();
									return;
								}
								settings.updateKey('transcription.selectedTranscriptionService', service.id);
								combobox.closeAndFocusTrigger();
							}}
							class="flex items-center gap-2 p-2"
						>
							<CheckIcon
								class={cn('size-4 shrink-0 ml-2', {
									'text-transparent': !isSelected,
								})}
							/>
							<div class="flex flex-col min-w-0">
								{@render renderServiceDisplay(service)}
								{#if !isLocalModelSupported}
									<span class="text-xs text-amber-600 ml-6">
										Requires macOS 15 (Sequoia) or later
									</span>
								{:else if isLocalModelDownloaded}
									<span class="text-xs text-muted-foreground ml-6">
										Apple Silicon · macOS 15+ · no API key
									</span>
								{:else}
									{@const qwenModel = QWEN3_ASR_MODELS.find((m) => m.id === settings.value['transcription.qwen3asr.modelId']) ?? QWEN3_ASR_MODELS[0]}
									<span class="text-xs text-amber-600 ml-6 flex items-center gap-1">
										<DownloadIcon class="size-3" />
										Model download required ({qwenModel.size})
									</span>
								{/if}
							</div>
						</Command.Item>
					</Command.Group>
				{/each}
			</Command.List>
			<Command.Item
				value="Configure transcription"
				onSelect={() => {
					goto('/settings/transcription');
					combobox.closeAndFocusTrigger();
				}}
				class="rounded-none p-2 bg-muted/50 text-muted-foreground"
			>
				<SettingsIcon class="size-4 mx-2.5" />
				Configure transcription
			</Command.Item>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
