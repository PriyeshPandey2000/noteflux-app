<script lang="ts">
	import type { Command } from '$lib/commands';
	import type { KeyboardEventSupportedKey } from '$lib/constants/keyboard';

	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { rpc } from '$lib/query';
	import { fromTaggedError } from '$lib/result';
	import {
		type Accelerator,
		pressedKeysToTauriAccelerator,
	} from '$lib/services/global-shortcut-manager';
	import { settings } from '$lib/stores/settings.svelte';
	import { onboardingStore } from '$lib/stores/onboarding.svelte';
	import { type PressedKeys } from '$lib/utils/createPressedKeys.svelte';
	import { keyToLabel } from '$lib/utils/key-label';

	import { createKeyRecorder } from './create-key-recorder.svelte';
	import KeyboardShortcutRecorder from './KeyboardShortcutRecorder.svelte';

	const {
		autoFocus = true,
		command,
		placeholder,
		pressedKeys,
		disabled = false,
	}: {
		autoFocus?: boolean;
		command: Command;
		placeholder?: string;
		pressedKeys: PressedKeys;
		disabled?: boolean;
	} = $props();

	const shortcutValue = $derived(
		settings.value[`shortcuts.global.${command.id}`],
	);

	// Check if coming from onboarding - only read once on mount
	let shouldRedirectToOnboarding = $state($page.url.searchParams.get('from') === 'onboarding');

	const keyRecorder = createKeyRecorder({
		onClear: async () => {
			const { error: unregisterError } =
				await rpc.shortcuts.unregisterCommandGlobally.execute({
					accelerator: shortcutValue as Accelerator,
				});

			if (unregisterError) {
				console.error('[Shortcut] Failed to unregister:', unregisterError);
				rpc.notify.error.execute(
					fromTaggedError(unregisterError, {
						title: 'Error clearing global shortcut',
					}),
				);
			}

			settings.updateKey(`shortcuts.global.${command.id}`, null);

			rpc.notify.success.execute({
				title: 'Global shortcut cleared',
				description: `Please set a new shortcut to trigger "${command.title}"`,
			});
		},
		onRegister: async (keyCombination: KeyboardEventSupportedKey[]) => {
			if (shortcutValue) {
				const { error: unregisterError } =
					await rpc.shortcuts.unregisterCommandGlobally.execute({
						accelerator: shortcutValue as Accelerator,
					});

				if (unregisterError) {
					console.error('[Shortcut] Failed to unregister:', unregisterError);
					rpc.notify.error.execute({
						title: 'Failed to unregister shortcut',
						description:
							'Could not unregister the global shortcut. It may already be in use by another application.',
					});
				}
			}

			const { data: accelerator, error: acceleratorError } =
				pressedKeysToTauriAccelerator(keyCombination);

			if (acceleratorError) {
				console.error('[Shortcut] Invalid combination:', keyCombination, acceleratorError);
				rpc.notify.error.execute({
					title: 'Invalid shortcut combination',
					description: `The key combination "${keyCombination.map(keyToLabel).join('+')}" is not valid. Please try a different combination.`,
				});
				return;
			}

			const { error: registerError } =
				await rpc.shortcuts.registerCommandGlobally.execute({
					accelerator,
					command,
				});

			if (registerError) {
				console.error('[Shortcut] Failed to register:', accelerator, registerError);
				switch (registerError.name) {
					case 'InvalidAcceleratorError':
						rpc.notify.error.execute({
							title: 'Invalid shortcut combination',
							description: `The key combination "${keyCombination.map(keyToLabel).join('+')}" is not valid. Please try a different combination.`,
						});
						break;
					default:
						rpc.notify.error.execute({
							title: 'Failed to register shortcut',
							description:
								'Could not register the global shortcut. It may already be in use by another application.',
						});
						break;
				}
				return;
			}

			settings.updateKey(`shortcuts.global.${command.id}`, accelerator);

			rpc.notify.success.execute({
				title: `Global shortcut set to ${accelerator}`,
				description: `Press the shortcut to trigger "${command.title}"`,
			});

			// Shortcut changed successfully - redirect will happen on dialog close
			// (shouldRedirectToOnboarding is already set if coming from onboarding)
		},
		pressedKeys,
	});

	function handleDialogClose() {
		if (shouldRedirectToOnboarding) {
			shouldRedirectToOnboarding = false;
			// Small delay to allow dialog cleanup before navigating
			setTimeout(() => {
				// Ensure body styles are reset before navigation
				if (typeof document !== 'undefined') {
					document.body.style.overflow = '';
					document.body.style.pointerEvents = '';
				}
				goto('/?reopenOnboarding=usage-guide');
			}, 150);
		}
	}
</script>

<KeyboardShortcutRecorder
	title={command.title}
	{placeholder}
	{autoFocus}
	rawKeyCombination={shortcutValue}
	{keyRecorder}
	onDialogClose={handleDialogClose}
	{disabled}
/>
