<script lang="ts">
	import FeedbackDialog from '$lib/components/feedback/FeedbackDialog.svelte';
	import { DiscordIcon, GithubIcon } from '$lib/components/icons';
	import NoteFluxButton from '$lib/components/NoteFluxButton.svelte';
	import * as DropdownMenu from '$lib/ui/dropdown-menu';
	import { cn } from '$lib/ui/utils';
	import {
		BugIcon,
		LayersIcon,
		ListIcon,
		Minimize2Icon,
		MoonIcon,
		MoreVerticalIcon,
		SettingsIcon,
		SunIcon,
	} from '@lucide/svelte';
	import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
	import { toggleMode } from 'mode-watcher';

	let {
		class: className,
		collapsed = false,
	}: { class?: string; collapsed?: boolean } = $props();

	let feedbackDialogOpen = $state(false);

	const navItems = [
		{
			href: '/recordings',
			icon: ListIcon,
			label: 'Recordings',
			type: 'anchor',
		},
		{
			href: '/transformations',
			icon: LayersIcon,
			label: 'Transformations',
			type: 'anchor',
		},
		{
			href: '/settings',
			icon: SettingsIcon,
			label: 'Settings',
			type: 'anchor',
		},
		// {
		// 	external: true,
		// 	href: 'https://github.com/PriyeshPandey2000/noteflux-app',
		// 	icon: GithubIcon,
		// 	label: 'View project on GitHub',
		// 	type: 'anchor',
		// },
		{
			action: toggleMode,
			icon: SunIcon,
			label: 'Toggle dark mode',
			type: 'theme',
		},
		{
			action: () => (feedbackDialogOpen = true),
			icon: BugIcon,
			label: 'Send feedback',
			type: 'button',
		},
		{
			external: true,
			href: 'https://discord.gg/T9nanY3aS',
			icon: DiscordIcon,
			label: 'Join Discord server',
			type: 'anchor',
		},
		// ...(window.__TAURI_INTERNALS__
		// 	? ([
		// 			{
		// 				action: () => getCurrentWindow().setSize(new LogicalSize(72, 84)),
		// 				icon: Minimize2Icon,
		// 				label: 'Minimize',
		// 				type: 'button',
		// 			},
		// 		] as const)
		// 	: []),
	] satisfies NavItem[];

	type BaseNavItem = {
		icon: unknown;
		label: string;
	};

	type AnchorItem = BaseNavItem & {
		external?: boolean;
		href: string;
		type: 'anchor';
	};

	type ButtonItem = BaseNavItem & {
		action: () => void;
		type: 'button';
	};

	type ThemeItem = BaseNavItem & {
		action: () => void;
		type: 'theme';
	};

	type NavItem = AnchorItem | ButtonItem | ThemeItem;
</script>

{#if collapsed}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<NoteFluxButton
					tooltipContent="Menu"
					variant="ghost"
					size="icon"
					class={className}
					{...props}
				>
					<MoreVerticalIcon class="size-4" aria-hidden="true" />
				</NoteFluxButton>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="w-56">
			{#each navItems as item}
				{@const Icon = item.icon}
				{#if item.type === 'anchor'}
					<DropdownMenu.Item>
						{#snippet child({ props })}
							<a
								href={item.href}
								target={item.external ? '_blank' : undefined}
								rel={item.external ? 'noopener noreferrer' : undefined}
								class="flex items-center gap-2"
								{...props}
							>
								<Icon class="size-4" aria-hidden="true" />
								<span>{item.label}</span>
							</a>
						{/snippet}
					</DropdownMenu.Item>
				{:else if item.type === 'button'}
					<DropdownMenu.Item
						onclick={item.action}
						class="flex items-center gap-2 cursor-pointer"
					>
						<Icon class="size-4" aria-hidden="true" />
						<span>{item.label}</span>
					</DropdownMenu.Item>
				{:else if item.type === 'theme'}
					<DropdownMenu.Item
						onclick={item.action}
						class="flex items-center gap-2 cursor-pointer"
					>
						<div class="relative size-4">
							<SunIcon
								class="absolute h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0"
							/>
							<MoonIcon
								class="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"
							/>
						</div>
						<span>{item.label}</span>
					</DropdownMenu.Item>
				{/if}
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{:else}
	<nav
		class={cn('flex items-center gap-1.5', className)}
		style="view-transition-name: nav"
	>
		{#each navItems as item}
			{@const Icon = item.icon}
			{#if item.type === 'anchor'}
				<NoteFluxButton
					tooltipContent={item.label}
					href={item.href}
					target={item.external ? '_blank' : undefined}
					rel={item.external ? 'noopener noreferrer' : undefined}
					variant="ghost"
					size="icon"
				>
					<Icon class="size-4" aria-hidden="true" />
				</NoteFluxButton>
			{:else if item.type === 'button'}
				<NoteFluxButton
					tooltipContent={item.label}
					onclick={item.action}
					variant="ghost"
					size="icon"
					class="cursor-pointer"
				>
					<Icon class="size-4" aria-hidden="true" />
				</NoteFluxButton>
			{:else if item.type === 'theme'}
				<NoteFluxButton
					tooltipContent={item.label}
					onclick={item.action}
					variant="ghost"
					size="icon"
					class="cursor-pointer"
				>
					<SunIcon
						class="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0"
					/>
					<MoonIcon
						class="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"
					/>
				</NoteFluxButton>
			{/if}
		{/each}
	</nav>
{/if}

<FeedbackDialog bind:open={feedbackDialogOpen} />

<style>
	@keyframes ping {
		75%,
		100% {
			transform: scale(2);
			opacity: 0;
		}
	}

	.animate-ping {
		animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;
	}
</style>
