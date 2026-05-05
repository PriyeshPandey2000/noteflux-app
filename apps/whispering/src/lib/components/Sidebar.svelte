<script lang="ts">
	import { page } from '$app/stores';
	import FeedbackDialog from '$lib/components/feedback/FeedbackDialog.svelte';
	import { DiscordIcon } from '$lib/components/icons';
	import NoteFluxButton from '$lib/components/NoteFluxButton.svelte';
	import { cn } from '$lib/ui/utils';
	import {
		BugIcon,
		ChevronLeft,
		HomeIcon,
		LayersIcon,
		ListIcon,
		SettingsIcon,
		SunIcon,
		MoonIcon,
		ZapIcon,
	} from '@lucide/svelte';
	import { toggleMode } from 'mode-watcher';
	import { auth } from '$lib/stores/auth.svelte';
	import { subscription } from '$lib/services/subscription/polar';

	let { class: className }: { class?: string } = $props();

	let isCollapsed = $state(false);
	let feedbackDialogOpen = $state(false);

	async function handleSubscribe() {
		await subscription.openCheckout(auth.user);
	}

	const navItems = [
		{
			href: '/',
			icon: HomeIcon,
			label: 'Home',
			type: 'anchor',
		},
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
	] as const;

	const footerItems = [
		{
			action: toggleMode,
			icon: SunIcon,
			label: 'Toggle theme',
			type: 'theme',
		},
		{
			action: () => (feedbackDialogOpen = true),
			icon: BugIcon,
			label: 'Send feedback',
			type: 'button',
		},
		{
			action: handleSubscribe,
			icon: ZapIcon,
			label: 'Subscribe',
			type: 'button',
			show: auth.isAuthenticated && !subscription.isPro,
		},
		{
			external: true,
			href: 'https://discord.gg/T9nanY3aS',
			icon: DiscordIcon,
			label: 'Join Discord',
			type: 'anchor',
		},
	] as const;
</script>

<aside
	class={cn(
		'bg-[#f5f3ff] dark:bg-[#0c0a09] border-r border-purple-100/50 dark:border-stone-800 flex flex-col h-screen sticky top-0 left-0 shrink-0 z-40 transition-all duration-300 relative group',
		isCollapsed ? 'w-[70px]' : 'w-[180px]',
		className
	)}
>
	<!-- Collapse Toggle Button -->
	<button
		onclick={() => (isCollapsed = !isCollapsed)}
		class="absolute -right-3 top-1/2 -translate-y-1/2 z-50 rounded-full bg-background border shadow-sm p-1 hover:bg-accent transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer"
		aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
	>
		<ChevronLeft class={cn('size-4 transition-transform duration-300', isCollapsed && 'rotate-180')} />
	</button>

	<!-- Header -->
	<div class={cn('h-16 flex items-center border-b border-purple-100/50 dark:border-stone-800', isCollapsed ? 'justify-center px-0' : 'px-6')}>
		<a href="/" class="flex items-center gap-3 hover:opacity-80 transition-opacity overflow-hidden whitespace-nowrap">
			<!-- Logo Icon Placeholder (if any, otherwise just text) -->
			{#if isCollapsed}
				<span class="text-xl font-bold text-foreground">N</span>
			{:else}
				<span class="text-xl font-bold text-foreground">NoteFlux</span>
			{/if}
		</a>
	</div>

	<!-- Main Navigation -->
	<nav class={cn('flex-1 space-y-1 overflow-y-auto overflow-x-hidden', isCollapsed ? 'p-3' : 'py-3 pl-3 pr-0')}>
		<div class="space-y-1">
			{#each navItems as item}
				{@const Icon = item.icon}
				{@const isActive = $page.url.pathname === item.href || ($page.url.pathname.startsWith(item.href) && item.href !== '/')}
				
				<a
					href={item.href}
					title={isCollapsed ? item.label : undefined}
					class={cn(
						'flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-all duration-200 overflow-hidden whitespace-nowrap cursor-pointer',
						isCollapsed ? 'justify-center px-2 rounded-md' : 'rounded-l-md rounded-r-none',
						isActive 
							? 'bg-[#e9d5ff] dark:bg-[#292524] text-purple-900 dark:text-stone-100 shadow-sm' 
							: 'text-muted-foreground hover:bg-[#f3e8ff] dark:hover:bg-[#292524] hover:text-foreground'
					)}
				>
					<Icon class={cn("size-5 shrink-0", isActive && "text-purple-700 dark:text-stone-200")} />
					<span class={cn('transition-opacity duration-300', isCollapsed ? 'opacity-0 w-0 hidden' : 'opacity-100')}>{item.label}</span>
				</a>
			{/each}
		</div>
	</nav>

	<!-- Footer -->
	<div class={cn('p-3 border-t border-purple-100/50 dark:border-stone-800 space-y-1', isCollapsed ? 'items-center flex flex-col' : '')}>
		{#each footerItems as item}
			{@const Icon = item.icon}
			{#if item.show !== undefined && !item.show}
				<!-- Skip hidden items -->
			{:else if item.type === 'anchor'}
				<a
					href={item.href}
					title={isCollapsed ? item.label : undefined}
					target={item.external ? '_blank' : undefined}
					rel={item.external ? 'noopener noreferrer' : undefined}
					class={cn(
						'flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-muted-foreground rounded-md hover:bg-[#f3e8ff] dark:hover:bg-[#292524] hover:text-foreground transition-colors overflow-hidden whitespace-nowrap',
						isCollapsed ? 'justify-center px-2 w-full' : ''
					)}
				>
					<Icon class="size-5 shrink-0" />
					<span class={cn('transition-opacity duration-300', isCollapsed ? 'opacity-0 w-0 hidden' : 'opacity-100')}>{item.label}</span>
				</a>
			{:else if item.type === 'button'}
				<button
					onclick={item.action}
					title={isCollapsed ? item.label : undefined}
					class={cn(
						'flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-muted-foreground rounded-md hover:bg-[#f3e8ff] dark:hover:bg-[#292524] hover:text-foreground transition-colors overflow-hidden whitespace-nowrap text-left cursor-pointer',
						isCollapsed ? 'justify-center px-2 w-full' : 'w-full'
					)}
				>
					<Icon class="size-5 shrink-0" />
					<span class={cn('transition-opacity duration-300', isCollapsed ? 'opacity-0 w-0 hidden' : 'opacity-100')}>{item.label}</span>
				</button>
			{:else if item.type === 'theme'}
				<button
					onclick={item.action}
					title={isCollapsed ? item.label : undefined}
					class={cn(
						'flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-muted-foreground rounded-md hover:bg-[#f3e8ff] dark:hover:bg-[#292524] hover:text-foreground transition-colors overflow-hidden whitespace-nowrap text-left group cursor-pointer',
						isCollapsed ? 'justify-center px-2 w-full' : 'w-full'
					)}
				>
					<div class="relative size-5 shrink-0">
						<SunIcon
							class="absolute top-0 left-0 size-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0"
						/>
						<MoonIcon
							class="absolute top-0 left-0 size-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"
						/>
					</div>
					<span class={cn('transition-opacity duration-300', isCollapsed ? 'opacity-0 w-0 hidden' : 'opacity-100')}>{item.label}</span>
				</button>
			{/if}
		{/each}
	</div>
</aside>

<FeedbackDialog bind:open={feedbackDialogOpen} />
