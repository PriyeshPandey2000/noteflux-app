import type { Recording } from '$lib/services/db';
import type { ColumnDef } from '@tanstack/table-core';

import { Badge } from '$lib/ui/badge';
import { Checkbox } from '$lib/ui/checkbox';
import { SelectAllPopover, SortableTableHeader } from '$lib/ui/table';
import { createRawSnippet } from 'svelte';
import { renderComponent } from '@tanstack/svelte-table';

import LatestTransformationRunOutputByRecordingId from './LatestTransformationRunOutputByRecordingId.svelte';
import CompactAudioPlayer from './CompactAudioPlayer.svelte';
import RenderAudioUrl from './RenderAudioUrl.svelte';
import { RecordingRowActions } from './row-actions';
import TranscribedTextDialog from './TranscribedTextDialog.svelte';

function formatLocalTime(isoString: string) {
	return new Date(isoString).toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	});
}

const selectColumn: ColumnDef<Recording> = {
	cell: ({ row }) =>
		renderComponent(Checkbox, {
			'aria-label': 'Select row',
			checked: row.getIsSelected(),
			onCheckedChange: (value) => row.toggleSelected(!!value),
		}),
	enableHiding: false,
	enableSorting: false,
	filterFn: (row, _columnId, filterValue) => {
		const title = String(row.getValue('title'));
		const subtitle = String(row.getValue('subtitle'));
		const transcribedText = String(row.getValue('transcribedText'));
		return (
			title.toLowerCase().includes(filterValue.toLowerCase()) ||
			subtitle.toLowerCase().includes(filterValue.toLowerCase()) ||
			transcribedText.toLowerCase().includes(filterValue.toLowerCase())
		);
	},
	header: ({ table }) => renderComponent(SelectAllPopover<Recording>, { table }),
	id: 'select',
};

const idColumn: ColumnDef<Recording> = {
	accessorKey: 'id',
	cell: ({ getValue }) => {
		const id = getValue<string>();
		return renderComponent(Badge, {
			children: createRawSnippet(() => ({
				render: () => id,
			})),
			variant: 'id',
		});
	},
	header: ({ column }) =>
		renderComponent(SortableTableHeader, { column, headerText: 'ID' }),
	id: 'ID',
};

const titleColumn: ColumnDef<Recording> = {
	accessorKey: 'title',
	header: ({ column }) =>
		renderComponent(SortableTableHeader, {
			column,
			headerText: 'Title',
		}),
	id: 'Title',
};

const subtitleColumn: ColumnDef<Recording> = {
	accessorKey: 'subtitle',
	header: ({ column }) =>
		renderComponent(SortableTableHeader, {
			column,
			headerText: 'Subtitle',
		}),
	id: 'Subtitle',
};

const timestampColumn: ColumnDef<Recording> = {
	accessorKey: 'timestamp',
	cell: ({ getValue }) => formatLocalTime(getValue<string>()),
	header: ({ column }) =>
		renderComponent(SortableTableHeader, {
			column,
			headerText: 'Timestamp',
		}),
	id: 'Timestamp',
	meta: {
		cellClassName: 'pl-2 pr-4 text-xs text-muted-foreground',
	},
};

const createdAtColumn: ColumnDef<Recording> = {
	accessorKey: 'createdAt',
	cell: ({ getValue }) => formatLocalTime(getValue<string>()),
	header: ({ column }) =>
		renderComponent(SortableTableHeader, {
			column,
			headerText: 'Created At',
		}),
	id: 'Created At',
};

const updatedAtColumn: ColumnDef<Recording> = {
	accessorKey: 'updatedAt',
	cell: ({ getValue }) => formatLocalTime(getValue<string>()),
	header: ({ column }) =>
		renderComponent(SortableTableHeader, {
			column,
			headerText: 'Updated At',
		}),
	id: 'Updated At',
};

const transcribedTextColumn: ColumnDef<Recording> = {
	accessorKey: 'transcribedText',
	cell: ({ getValue, row }) => {
		const transcribedText = getValue<string>();
		if (!transcribedText) return;
		return renderComponent(TranscribedTextDialog, {
			recordingId: row.id,
			transcribedText,
		});
	},
	header: ({ column }) =>
		renderComponent(SortableTableHeader, {
			column,
			headerText: 'Transcribed Text',
		}),
	id: 'Transcribed Text',
	meta: {
		cellClassName: 'min-w-[280px]',
	},
};

const latestTransformationRunOutputColumn: ColumnDef<Recording> = {
	accessorFn: ({ id }) => id,
	cell: ({ getValue }) => {
		const recordingId = getValue<string>();
		return renderComponent(LatestTransformationRunOutputByRecordingId, {
			recordingId,
		});
	},
	header: ({ column }) =>
		renderComponent(SortableTableHeader, {
			column,
			headerText: 'Latest Transformation Run Output',
		}),
	id: 'Latest Transformation Run Output',
};

const audioColumn: ColumnDef<Recording> = {
	accessorFn: ({ blob, id }) => ({ blob, id }),
	cell: ({ getValue }) => {
		const { blob, id } = getValue<Pick<Recording, 'blob' | 'id'>>();
		return renderComponent(RenderAudioUrl, { blob, id });
	},
	header: ({ column }) =>
		renderComponent(SortableTableHeader, {
			column,
			headerText: 'Audio',
		}),
	id: 'Audio',
};

const compactAudioColumn: ColumnDef<Recording> = {
	accessorFn: ({ blob }) => ({ blob }),
	cell: ({ getValue }) => {
		const { blob } = getValue<Pick<Recording, 'blob'>>();
		return renderComponent(CompactAudioPlayer, { blob });
	},
	header: ({ column }) =>
		renderComponent(SortableTableHeader, {
			column,
			headerText: 'Audio',
		}),
	id: 'Audio',
};

const actionsColumn: ColumnDef<Recording> = {
	accessorFn: (recording) => recording,
	cell: ({ getValue }) => {
		const recording = getValue<Recording>();
		return renderComponent(RecordingRowActions, {
			recordingId: recording.id,
		});
	},
	header: ({ column }) =>
		renderComponent(SortableTableHeader, {
			column,
			headerText: 'Actions',
		}),
	id: 'Actions',
};

export const recordingsPageColumns: ColumnDef<Recording>[] = [
	selectColumn,
	timestampColumn,
	transcribedTextColumn,
	latestTransformationRunOutputColumn,
	compactAudioColumn,
	actionsColumn,
];

export const homepageRecentRecordingsColumns: ColumnDef<Recording>[] = [
	timestampColumn,
	transcribedTextColumn,
	compactAudioColumn,
	actionsColumn,
];



