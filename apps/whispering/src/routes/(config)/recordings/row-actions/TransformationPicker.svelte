<script lang="ts">
	import type { Transformation } from '$lib/services/db';

	import { goto } from '$app/navigation';
	import { rpc } from '$lib/query';
	import { Badge } from '$lib/ui/badge';
	import * as DropdownMenu from '$lib/ui/dropdown-menu';
	import { WandSparklesIcon } from '@lucide/svelte';
	import { createQuery } from '@tanstack/svelte-query';

	const transformationsQuery = createQuery(
		rpc.transformations.queries.getAllTransformations.options,
	);

	const transformations = $derived(transformationsQuery.data ?? []);

	let {
		onSelect,
	}: {
		onSelect: (transformation: Transformation) => void;
	} = $props();
</script>

<DropdownMenu.Sub>
	<DropdownMenu.SubTrigger>
		<WandSparklesIcon />
		Transform
	</DropdownMenu.SubTrigger>
	<DropdownMenu.SubContent>
		{#if transformationsQuery.isPending}
			<DropdownMenu.Item disabled>Loading transformations…</DropdownMenu.Item>
		{:else if transformations.length === 0}
			<DropdownMenu.Item disabled>No transformations yet</DropdownMenu.Item>
		{:else}
			{#each transformations as transformation (transformation.id)}
				<DropdownMenu.Item
					onSelect={() => {
						onSelect(transformation);
					}}
				>
					<Badge variant="id" class="shrink-0 max-w-16 truncate">
						{transformation.id}
					</Badge>
					<span class="truncate font-medium">
						{transformation.title}
					</span>
				</DropdownMenu.Item>
			{/each}
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={() => goto('/transformations')}>
				<WandSparklesIcon />
				Manage transformations
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.SubContent>
</DropdownMenu.Sub>