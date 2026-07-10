<script lang="ts">
	import {
		DEFAULT_QWEN3_ASR_MODEL_ID,
		QWEN3_ASR_MODELS,
		type Qwen3ASRModelId,
	} from '$lib/services/transcription/qwen3-asr';
	import * as services from '$lib/services';
	import { settings } from '$lib/stores/settings.svelte';
	import * as AlertDialog from '$lib/ui/alert-dialog';
	import { Button } from '$lib/ui/button';
	import * as Card from '$lib/ui/card';
	import * as ToggleGroup from '$lib/ui/toggle-group';
	import {
		AlertCircleIcon,
		CheckCircle2Icon,
		DownloadIcon,
		Loader2Icon,
		Trash2Icon,
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	type ModelStep =
		| { step: 'checking' }
		| { step: 'not_supported' }
		| { step: 'not_downloaded' }
		| { step: 'downloading'; percent: number }
		| { step: 'warming_up' }
		| { step: 'downloaded' }
		| { step: 'deleting' };

	// Per-model state
	let modelStates = $state<Record<string, ModelStep>>({
		'aufklarer/Qwen3-ASR-0.6B-MLX-4bit': { step: 'checking' },
		'mlx-community/Qwen3-ASR-1.7B-4bit': { step: 'checking' },
	});

	let deleteDialogOpenFor = $state<string | null>(null);
	let macOSSupported = $state(true);

	const selectedModelId = $derived(
		(settings.value['transcription.qwen3asr.modelId'] as Qwen3ASRModelId) ??
			DEFAULT_QWEN3_ASR_MODEL_ID,
	);

	$effect(() => {
		services.transcriptions.qwen3asr.isMacOSSupported().then((supported) => {
			macOSSupported = supported;
			if (!supported) {
				for (const key of Object.keys(modelStates)) {
					modelStates[key] = { step: 'not_supported' };
				}
				return;
			}
			for (const model of QWEN3_ASR_MODELS) {
				services.transcriptions.qwen3asr.getModelStatus(model.id).then((status) => {
					modelStates[model.id] = { step: status };
				});
			}
		});
	});

	async function startDownload(modelId: Qwen3ASRModelId) {
		modelStates[modelId] = { step: 'downloading', percent: 0 };

		const { error } = await services.transcriptions.qwen3asr.downloadModel(
			modelId,
			(percent) => {
				modelStates[modelId] = { step: 'downloading', percent };
			},
		);

		if (error) {
			modelStates[modelId] = { step: 'not_downloaded' };
			toast.error(error.title, { description: error.description });
			return;
		}

		modelStates[modelId] = { step: 'warming_up' };

		try {
			await services.transcriptions.qwen3asr.preload(modelId);
		} catch {
			// Preload failed but model is on disk — user can still try recording
		}

		modelStates[modelId] = { step: 'downloaded' };
		toast.success('Model ready', {
			description: 'Qwen3-ASR is loaded and ready for on-device transcription.',
		});
	}

	async function deleteModel(modelId: Qwen3ASRModelId) {
		deleteDialogOpenFor = null;
		modelStates[modelId] = { step: 'deleting' };

		const { error } = await services.transcriptions.qwen3asr.deleteModel(modelId);

		if (error) {
			modelStates[modelId] = { step: 'downloaded' };
			toast.error(error.title, { description: error.description });
			return;
		}

		modelStates[modelId] = { step: 'not_downloaded' };
		toast.success('Model deleted', { description: 'Disk space freed.' });
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="text-lg">Qwen3-ASR (Local)</Card.Title>
		<Card.Description>
			On-device transcription via Apple MLX. No API key required. Apple Silicon + macOS
			15+ only.
		</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-4">
		{#if !macOSSupported}
			<div class="flex items-center gap-2 text-sm text-amber-600">
				<AlertCircleIcon class="size-4 shrink-0" />
				Requires macOS 15 (Sequoia) or later
			</div>
		{:else}
			<!-- Model selector -->
			<ToggleGroup.Root
				type="single"
				value={selectedModelId}
				onValueChange={(v) => {
					if (v) settings.updateKey('transcription.qwen3asr.modelId', v);
				}}
				class="justify-start gap-2"
			>
				{#each QWEN3_ASR_MODELS as model (model.id)}
					<ToggleGroup.Item value={model.id} class="flex flex-col items-start h-auto px-3 py-2 text-left">
						<span class="font-medium text-sm">{model.label}</span>
						<span class="text-xs text-muted-foreground">{model.size} · {model.ram} RAM</span>
					</ToggleGroup.Item>
				{/each}
			</ToggleGroup.Root>

			<!-- State for each model -->
			{#each QWEN3_ASR_MODELS as model (model.id)}
				{@const state = modelStates[model.id]}
				{@const isActive = model.id === selectedModelId}
				<div class={isActive ? 'space-y-2' : 'hidden'}>
					<p class="text-xs text-muted-foreground">{model.description}</p>

					{#if state.step === 'checking'}
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2Icon class="size-4 animate-spin" />
							Checking model status...
						</div>
					{:else if state.step === 'not_downloaded'}
						<div class="space-y-2">
							<p class="text-sm text-muted-foreground">
								One-time download required. Transcription runs fully offline after.
							</p>
							<Button onclick={() => startDownload(model.id)} size="sm">
								<DownloadIcon class="size-4 mr-2" />
								Download ({model.size})
							</Button>
						</div>
					{:else if state.step === 'downloading'}
						<div class="space-y-2">
							<div class="flex items-center justify-between text-sm">
								<span class="text-muted-foreground">Downloading...</span>
								<span class="font-medium tabular-nums">{state.percent}%</span>
							</div>
							<div class="h-2 w-full rounded-full bg-muted overflow-hidden">
								<div
									class="h-full rounded-full bg-primary transition-all duration-300"
									style="width: {state.percent}%"
								></div>
							</div>
							<p class="text-xs text-muted-foreground">Keep the app open until download finishes.</p>
						</div>
					{:else if state.step === 'warming_up'}
						<div class="space-y-2">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<Loader2Icon class="size-4 animate-spin shrink-0" />
								<span>Loading model into memory<span class="text-xs ml-1 text-muted-foreground/70">(first run only — compiling GPU shaders)</span></span>
							</div>
							<p class="text-xs text-muted-foreground">
								This takes 2–4 minutes once. All future loads are instant. Keep the app open.
							</p>
						</div>
					{:else if state.step === 'downloaded'}
						<div class="space-y-2">
							<div class="flex items-center gap-2 text-sm text-green-600">
								<CheckCircle2Icon class="size-4" />
								Downloaded — ready for on-device transcription
							</div>
							<AlertDialog.Root
								open={deleteDialogOpenFor === model.id}
								onOpenChange={(v) => { if (!v) deleteDialogOpenFor = null; }}
							>
								<AlertDialog.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											onclick={() => (deleteDialogOpenFor = model.id)}
											variant="outline"
											size="sm"
										>
											<Trash2Icon class="size-4 mr-2" />
											Delete model
										</Button>
									{/snippet}
								</AlertDialog.Trigger>
								<AlertDialog.Content>
									<AlertDialog.Header>
										<AlertDialog.Title>Delete {model.label}?</AlertDialog.Title>
										<AlertDialog.Description>
											Deletes model from disk and frees {model.size}. On-device
											transcription stops working until you download it again.
										</AlertDialog.Description>
									</AlertDialog.Header>
									<AlertDialog.Footer>
										<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
										<AlertDialog.Action onclick={() => deleteModel(model.id)}>
											Delete
										</AlertDialog.Action>
									</AlertDialog.Footer>
								</AlertDialog.Content>
							</AlertDialog.Root>
						</div>
					{:else if state.step === 'deleting'}
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2Icon class="size-4 animate-spin" />
							Deleting model...
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</Card.Content>
</Card.Root>
