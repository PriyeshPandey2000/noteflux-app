<script lang="ts">
	import { Button } from '$lib/ui/button';
	import { onMount } from 'svelte';
	import { rpc } from '$lib/query';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MicIcon from '@lucide/svelte/icons/mic';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import LockIcon from '@lucide/svelte/icons/lock';
	import VoiceRing from './VoiceRing.svelte';

	type Props = {
		onNext: () => void;
		onComplete: (complete: boolean) => void;
	};

	let { onNext, onComplete }: Props = $props();

	type PermissionStatus = 'unknown' | 'granted' | 'denied' | 'requesting';

	let microphoneStatus = $state<PermissionStatus>('unknown');
	let accessibilityStatus = $state<PermissionStatus>('unknown');
	let isCheckingPermissions = $state(false);

	const isDesktop = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
	const totalSteps = isDesktop ? 2 : 1;

	const completedSteps = $derived(
		(microphoneStatus === 'granted' ? 1 : 0) +
			(isDesktop && accessibilityStatus === 'granted' ? 1 : 0)
	);

	const allRequiredGranted = $derived(
		microphoneStatus === 'granted' &&
			(!isDesktop || accessibilityStatus === 'granted')
	);

	async function checkPermissions() {
		isCheckingPermissions = true;

		const hasMic = await checkMicrophonePermission();
		microphoneStatus = hasMic ? 'granted' : 'denied';

		if (isDesktop) {
			const hasAccessibility = await checkAccessibilityPermission();
			accessibilityStatus = hasAccessibility ? 'granted' : 'denied';
		}

		isCheckingPermissions = false;
		onComplete(allRequiredGranted);
	}

	async function checkMicrophonePermission(): Promise<boolean> {
		try {
			if ('permissions' in navigator) {
				const permissionStatus = await navigator.permissions.query({
					name: 'microphone' as PermissionName,
				});
				return permissionStatus.state === 'granted';
			}
			return false;
		} catch {
			return false;
		}
	}

	async function checkAccessibilityPermission(): Promise<boolean> {
		if (!isDesktop) return true;

		try {
			const { invoke } = await import('@tauri-apps/api/core');
			return await invoke<boolean>('is_macos_accessibility_enabled', {
				askIfNotAllowed: false,
			});
		} catch {
			return false;
		}
	}

	async function requestMicrophonePermission() {
		microphoneStatus = 'requesting';

		try {
			let tauriWindow = null;
			if (isDesktop) {
				try {
					const { getCurrentWindow } = await import('@tauri-apps/api/window');
					tauriWindow = getCurrentWindow();
					await tauriWindow.show();
					await tauriWindow.unminimize();
					await tauriWindow.setFocus();
					await tauriWindow.setAlwaysOnTop(true);
					await tauriWindow.setFocus();
					await new Promise((resolve) => setTimeout(resolve, 500));
					await tauriWindow.setFocus();
				} catch (e) {
					console.log('Could not set window state:', e);
				}
			}

			const stream = await navigator.mediaDevices.getUserMedia({
				audio: true,
				video: false,
			});

			if (stream) {
				stream.getTracks().forEach((track) => track.stop());
				microphoneStatus = 'granted';

				if (tauriWindow) {
					try {
						await tauriWindow.setAlwaysOnTop(false);
						await tauriWindow.setFocus();
					} catch (e) {
						console.log('Could not restore window:', e);
					}
				}

				rpc.notify.success.execute({
					title: 'Microphone access granted',
					description: 'You can now record audio',
				});
			}
		} catch {
			microphoneStatus = 'denied';
			rpc.notify.error.execute({
				title: 'Microphone access denied',
				description: 'Please allow microphone access in your system settings',
			});
		}

		checkPermissions();
	}

	async function requestAccessibilityPermission() {
		if (!isDesktop) return;

		accessibilityStatus = 'requesting';

		try {
			// Disable always-on-top so user can see System Settings dialog
			let tauriWindow = null;
			try {
				const { getCurrentWindow } = await import('@tauri-apps/api/window');
				tauriWindow = getCurrentWindow();
				await tauriWindow.setAlwaysOnTop(false);
			} catch (e) {
				console.log('Could not disable always on top:', e);
			}

			const { invoke } = await import('@tauri-apps/api/core');
			await invoke<boolean>('is_macos_accessibility_enabled', {
				askIfNotAllowed: true,
			});

			await new Promise((resolve) => setTimeout(resolve, 1000));

			const finalResult = await invoke<boolean>('is_macos_accessibility_enabled', {
				askIfNotAllowed: false,
			});

			if (finalResult) {
				accessibilityStatus = 'granted';
				rpc.notify.success.execute({
					title: 'Accessibility access granted',
					description: 'You can now use direct paste',
				});
			} else {
				accessibilityStatus = 'denied';
				rpc.notify.warning.execute({
					title: 'Accessibility permission needed',
					description: 'Enable in System Settings > Privacy > Accessibility',
				});
			}
		} catch {
			accessibilityStatus = 'denied';
		}

		checkPermissions();
	}

	onMount(() => {
		checkPermissions();

		const interval = setInterval(() => {
			if (!isCheckingPermissions) {
				checkPermissions();
			}
		}, 2000);

		return () => clearInterval(interval);
	});
</script>

{#snippet permissionCard(
	status: PermissionStatus,
	title: string,
	description: string,
	Icon: typeof MicIcon,
	action: () => void,
	actionLabel: string,
	requestingLabel: string,
)}
	<div
		class="relative flex items-center gap-3 p-3.5 rounded-xl border transition-all duration-500 {status ===
		'granted'
			? 'border-green-500/40 bg-green-500/[0.07]'
			: 'border-white/10 bg-white/[0.03]'}"
	>
		<div
			class="relative w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all duration-500 {status ===
			'granted'
				? 'bg-gradient-to-br from-green-400 to-emerald-600 text-white shadow-[0_0_18px_rgba(74,222,128,0.45)]'
				: 'bg-white/[0.06] text-white/70'}"
		>
			{#if status === 'granted'}
				<span class="ping"></span>
				<CheckIcon class="w-5 h-5" />
			{:else}
				<Icon class="w-5 h-5" />
			{/if}
		</div>

		<div class="flex-1 min-w-0 text-left">
			<h3 class="font-medium text-sm text-white/90">{title}</h3>
			<p class="text-xs text-white/45 mt-0.5">{description}</p>
		</div>

		<div class="shrink-0">
			{#if status === 'granted'}
				<span class="text-xs font-medium text-green-400">Granted</span>
			{:else if status === 'requesting'}
				<span class="flex items-center gap-1.5 text-xs text-white/50">
					<LoaderIcon class="w-3 h-3 animate-spin" />
					{requestingLabel}
				</span>
			{:else}
				<Button size="sm" onclick={action} class="cursor-pointer">{actionLabel}</Button>
			{/if}
		</div>
	</div>
{/snippet}

<div class="flex flex-col items-center px-8 pt-6 pb-8 space-y-5">
	<VoiceRing state={allRequiredGranted ? 'done' : 'idle'} size={96} />

	<div class="text-center space-y-1.5">
		<h2 class="text-2xl font-semibold tracking-tight text-white">
			{allRequiredGranted ? 'Ears on. Hands free.' : 'Two quick yeses'}
		</h2>
		<p class="text-sm text-white/50">
			{allRequiredGranted
				? 'Continuing…'
				: 'So NoteFlux can hear you and type for you.'}
		</p>
	</div>

	<div class="w-full space-y-3">
		{@render permissionCard(
			microphoneStatus,
			'Microphone',
			'So you can speak instead of type',
			MicIcon,
			requestMicrophonePermission,
			'Allow',
			'Waiting…',
		)}
		{#if isDesktop}
			{@render permissionCard(
				accessibilityStatus,
				'Accessibility',
				'So your words land in any app, instantly',
				ShieldIcon,
				requestAccessibilityPermission,
				'Open Settings',
				'Opening…',
			)}
		{/if}
	</div>

	<div class="flex items-center gap-1.5 text-[11px] text-white/35">
		<LockIcon class="w-3 h-3" />
		<span>Your mic is only used while you're recording · {completedSteps}/{totalSteps} granted</span>
	</div>
</div>

<style>
	.ping {
		position: absolute;
		inset: 0;
		border-radius: 0.75rem;
		border: 2px solid rgba(74, 222, 128, 0.7);
		animation: ping 0.9s ease-out 1 forwards;
	}

	@keyframes ping {
		from {
			transform: scale(1);
			opacity: 1;
		}
		to {
			transform: scale(1.7);
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ping {
			animation: none;
			opacity: 0;
		}
	}
</style>
