<script lang="ts">
	import { confirmationDialog } from '$lib/components/ConfirmationDialog.svelte';
	import CopyToClipboardButton from '$lib/components/copyable/CopyToClipboardButton.svelte';
	import { ClipboardIcon, PencilIcon, TrashIcon } from '$lib/components/icons';
	import NoteFluxButton from '$lib/components/NoteFluxButton.svelte';
	import { rpc } from '$lib/query';
	import { Skeleton } from '$lib/ui/skeleton';
	import * as DropdownMenu from '$lib/ui/dropdown-menu';
	import { getRecordingTransitionId } from '$lib/utils/getRecordingTransitionId';
	import {
		AlertCircleIcon,
		ArrowDownToLineIcon,
		ClipboardCopyIcon,
		EllipsisIcon,
		ListChecksIcon,
		Loader2Icon,
		MoreHorizontalIcon,
		PlayIcon,
		RepeatIcon,
	} from '@lucide/svelte';
	import { createMutation, createQuery } from '@tanstack/svelte-query';
	import { nanoid } from 'nanoid/non-secure';

	import EditRecordingModal from './EditRecordingModal.svelte';
	import TransformationPicker from './TransformationPicker.svelte';
	import ViewTransformationRunsDialog from './ViewTransformationRunsDialog.svelte';

	const transcribeRecording = createMutation(
		rpc.transcription.transcribeRecording.options,
	);

	const transformRecording = createMutation(
		rpc.transformer.transformRecording.options,
	);

	const deleteRecording = createMutation(
		rpc.recordings.deleteRecording.options,
	);

	const downloadRecording = createMutation(
		rpc.download.downloadRecording.options,
	);

	const copyToClipboard = createMutation(
		rpc.clipboard.copyToClipboard.options,
	);

	let { recordingId }: { recordingId: string } = $props();

	let isEditOpen = $state(false);
	let isViewRunsOpen = $state(false);

	const latestTransformationRunByRecordingIdQuery = createQuery(
		rpc.transformationRuns.getLatestTransformationRunByRecordingId(
			() => recordingId,
		).options,
	);

	const latestCompletedTransformOutput = $derived(
		latestTransformationRunByRecordingIdQuery.data?.status === 'completed'
			? latestTransformationRunByRecordingIdQuery.data.output
			: null,
	);

	const recordingQuery = createQuery(
		rpc.recordings.getRecordingById(() => recordingId).options,
	);

	const recording = $derived(recordingQuery.data);
</script>

<div class="flex items-center gap-0.5">
	{#if !recording}
		<Skeleton class="size-6" />
		<Skeleton class="size-6" />
		<Skeleton class="size-6" />
	{:else}
		<NoteFluxButton
			tooltipContent={recording.transcriptionStatus === 'UNPROCESSED'
				? 'Start transcribing this recording'
				: recording.transcriptionStatus === 'TRANSCRIBING'
					? 'Currently transcribing...'
					: recording.transcriptionStatus === 'DONE'
						? 'Retry transcription'
						: 'Transcription failed - click to try again'}
			onclick={() => {
				const toastId = nanoid();
				rpc.notify.loading.execute({
					title: '📋 Transcribing...',
					description: 'Your recording is being transcribed...',
					id: toastId,
				});
				transcribeRecording.mutate(recording, {
					onError: (error) => {
						if (error.name === 'NoteFluxError') {
							rpc.notify.error.execute({ id: toastId, ...error });
							return;
						}
						rpc.notify.error.execute({
							title: '❌ Failed to transcribe recording',
							description: 'Your recording could not be transcribed.',
							action: { error: error, type: 'more-details' },
							id: toastId,
						});
					},
					onSuccess: (transcribedText) => {
						rpc.sound.playSoundIfEnabled.execute('transcriptionComplete');

						rpc.delivery.deliverTranscriptionResult.execute({
							text: transcribedText,
							toastId,
						});
					},
				});
			}}
			variant="ghost"
			size="icon"
			class="size-6"
		>
			{#if recording.transcriptionStatus === 'UNPROCESSED'}
				<PlayIcon class="size-3" />
			{:else if recording.transcriptionStatus === 'TRANSCRIBING'}
				<EllipsisIcon class="size-3" />
			{:else if recording.transcriptionStatus === 'DONE'}
				<RepeatIcon class="size-4 text-green-500" />
			{:else if recording.transcriptionStatus === 'FAILED'}
				<AlertCircleIcon class="size-4 text-red-500" />
			{/if}
		</NoteFluxButton>

		<CopyToClipboardButton
			contentDescription="transcribed text"
			textToCopy={recording.transcribedText}
			viewTransitionName={getRecordingTransitionId({
				propertyName: 'transcribedText',
				recordingId,
			})}
		>
			<ClipboardIcon class="size-3" />
		</CopyToClipboardButton>

		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				class="inline-flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
				aria-label="More actions"
				title="More actions"
			>
				<MoreHorizontalIcon class="size-3.5" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="min-w-[190px]">
				<DropdownMenu.Item
					onSelect={() => setTimeout(() => (isEditOpen = true), 0)}
				>
					<PencilIcon class="size-4" />
					Edit
				</DropdownMenu.Item>

				<TransformationPicker
					onSelect={(transformation) => {
						const toastId = nanoid();
						rpc.notify.loading.execute({
							title: '🔄 Running transformation...',
							description:
								'Applying your selected transformation to the transcribed text...',
							id: toastId,
						});
						transformRecording.mutate(
							{ recordingId: recording.id, transformation },
							{
								onError: (error) => rpc.notify.error.execute(error),
								onSuccess: (transformationRun) => {
									if (transformationRun.status === 'failed') {
										rpc.notify.error.execute({
											title: '⚠️ Transformation error',
											description: transformationRun.error,
											action: {
												error: transformationRun.error,
												type: 'more-details',
											},
										});
										return;
									}

									rpc.sound.playSoundIfEnabled.execute('transformationComplete');

									rpc.delivery.deliverTransformationResult.execute({
										text: transformationRun.output,
										toastId,
									});
								},
							},
						);
					}}
				/>

				{#if latestCompletedTransformOutput}
					<DropdownMenu.Item
						onSelect={() =>
							copyToClipboard.mutate(
								{ text: latestCompletedTransformOutput },
								{
									onError: (error) => {
										rpc.notify.error.execute({
											title: 'Error copying transformation output to clipboard',
											description: error.message,
											action: { error, type: 'more-details' },
										});
									},
									onSuccess: () => {
										rpc.notify.success.execute({
											title: 'Copied transformation output to clipboard!',
											description: latestCompletedTransformOutput,
										});
									},
								},
							)}
						disabled={copyToClipboard.isPending}
					>
						{#if copyToClipboard.isPending}
							<Loader2Icon class="animate-spin" />
						{:else}
							<ClipboardCopyIcon />
						{/if}
						Copy transformation output
					</DropdownMenu.Item>
				{/if}

				<DropdownMenu.Item
					onSelect={() => setTimeout(() => (isViewRunsOpen = true), 0)}
				>
					<ListChecksIcon />
					View runs
				</DropdownMenu.Item>

				<DropdownMenu.Item
					onSelect={() =>
						downloadRecording.mutate(recording, {
							onError: (error) => {
								if (error.name === 'NoteFluxError') {
									rpc.notify.error.execute(error);
									return;
								}
								rpc.notify.error.execute({
									title: 'Failed to download recording!',
									description: 'Your recording could not be downloaded.',
									action: { error, type: 'more-details' },
								});
							},
							onSuccess: () => {
								rpc.notify.success.execute({
									title: 'Recording downloaded!',
									description: 'Your recording has been downloaded.',
								});
							},
						})}
					disabled={downloadRecording.isPending}
				>
					{#if downloadRecording.isPending}
						<Loader2Icon class="animate-spin" />
						Downloading…
					{:else}
						<ArrowDownToLineIcon />
						Download
					{/if}
				</DropdownMenu.Item>

				<DropdownMenu.Separator />

				<DropdownMenu.Item
					variant="destructive"
					onSelect={() =>
						setTimeout(() => {
							confirmationDialog.open({
								title: 'Delete recording',
								confirmText: 'Delete',
								onConfirm: () =>
									deleteRecording.mutate(recording, {
										onError: (error) => {
											rpc.notify.error.execute({
												title: 'Failed to delete recording!',
												description:
													'Your recording could not be deleted.',
												action: { error, type: 'more-details' },
											});
										},
										onSuccess: () => {
											rpc.notify.success.execute({
												title: 'Deleted recording!',
												description: 'Your recording has been deleted.',
											});
										},
									}),
								subtitle: 'Are you sure you want to delete this recording?',
							});
						})
					}
				>
					<TrashIcon class="size-4" />
					Delete
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>

		<EditRecordingModal {recording} bind:open={isEditOpen} />
		<ViewTransformationRunsDialog {recordingId} bind:open={isViewRunsOpen} />
	{/if}
</div>
