import { invoke } from '@tauri-apps/api/core';
import { createTaggedError, extractErrorMessage } from 'wellcrafted/error';
import { Err, Ok, type Result, tryAsync } from 'wellcrafted/result';

const { PermissionMonitorErr, PermissionMonitorError } = createTaggedError(
	'PermissionMonitorError',
);

type PermissionMonitorError = ReturnType<typeof PermissionMonitorError>;
type PermissionStatus = 'unknown' | 'granted' | 'denied';

/**
 * Creates a global permission monitoring service that runs throughout the app's lifecycle.
 * Monitors accessibility permission changes and reinitializes Fn manager when permission is granted.
 */
export function createPermissionMonitor() {
	let intervalId: ReturnType<typeof setInterval> | null = null;
	let previousStatus: PermissionStatus = 'unknown';
	let reinitializeInProgress = false;
	// Revocation used to only be logged to the console — invisible to a real
	// user, who'd just see Fn silently stop working with no explanation.
	// The UI layer (AppShell.svelte) registers a callback here so it can
	// surface an actual notification instead. Kept as a plain callback (not
	// a store) so this file stays dependency-light — no reason for a
	// detection service to import the notification/UI layer directly.
	let onRevokedCallback: (() => void) | null = null;

	return {
		onRevoked(callback: () => void) {
			onRevokedCallback = callback;
		},

		/**
		 * Check if Fn manager is currently being initialized
		 */
		get isInitializing(): boolean {
			return reinitializeInProgress;
		},

		/**
		 * Checks if macOS accessibility permission is currently granted
		 */
		async checkAccessibilityPermission(): Promise<
			Result<boolean, PermissionMonitorError>
		> {
			const { data, error } = await tryAsync({
				mapErr: (error) =>
					PermissionMonitorErr({
						cause: error,
						context: { error },
						message: `Failed to check accessibility permission: ${extractErrorMessage(error)}`,
					}),
				try: () =>
					invoke<boolean>('is_macos_accessibility_enabled', {
						askIfNotAllowed: false,
					}),
			});

			if (error) return Err(error);
			return Ok(data);
		},

		/**
		 * Attempts to reinitialize the Fn manager after accessibility permission is granted.
		 * Uses exponential backoff retry instead of fixed delays for minimum latency.
		 */
		async attemptReinitialize(): Promise<Result<void, PermissionMonitorError>> {
			if (reinitializeInProgress) {
				// console.log(
				// 	'[PermissionMonitor] ⏭️ Reinitialize already in progress, skipping duplicate attempt',
				// );
				return Ok(undefined);
			}

			reinitializeInProgress = true;

			try {
				// console.log('[PermissionMonitor] 🔄 Attempting immediate reinitialize...');

				// Try immediately first (0 latency in best case)
				let attempt = 0;
				const maxAttempts = 6; // Will try: 0ms, 100ms, 200ms, 400ms, 800ms, 1600ms
				let lastError: PermissionMonitorError | null = null;

				while (attempt < maxAttempts) {
					// Verify permission is still granted before attempting
					const { data: stillGranted, error: checkError } =
						await this.checkAccessibilityPermission();
					if (checkError) {
						reinitializeInProgress = false;
						return Err(checkError);
					}

					if (!stillGranted) {
						console.warn(
							'[PermissionMonitor] ⚠️ Permission no longer granted, aborting reinitialize',
						);
						reinitializeInProgress = false;
						return Ok(undefined);
					}

					// Attempt reinitialize
					const { error: reinitializeError } = await tryAsync({
						mapErr: (error) =>
							PermissionMonitorErr({
								cause: error,
								context: { error, attempt },
								message: `Failed to reinitialize Fn manager: ${extractErrorMessage(error)}`,
							}),
						try: () => invoke('reinitialize_fn_manager'),
					});

					if (!reinitializeError) {
						// Success!
						// console.log(
						// 	`[PermissionMonitor] ✓ Fn manager initialized successfully on attempt ${attempt + 1}`,
						// );
						break;
					}

					// Failed - check if we should retry
					lastError = reinitializeError;
					attempt++;

					if (attempt < maxAttempts) {
						const backoffMs = Math.pow(2, attempt - 1) * 100; // Exponential backoff
						// console.log(
						// 	`[PermissionMonitor] ⏳ Attempt ${attempt} failed, retrying in ${backoffMs}ms...`,
						// );
						await new Promise((resolve) => setTimeout(resolve, backoffMs));
					} else {
						console.error(
							'[PermissionMonitor] ✗ All reinitialize attempts failed:',
							lastError,
						);
						reinitializeInProgress = false;
						return Err(lastError);
					}
				}

				// Re-register all shortcuts with the newly initialized manager
				// console.log(
				// 	'[PermissionMonitor] 🔄 Re-registering shortcuts with new manager...',
				// );
				const { syncGlobalShortcutsWithSettings } = await import(
					'../../routes/+layout/register-commands'
				);
				await syncGlobalShortcutsWithSettings();
				// console.log('[PermissionMonitor] ✓ Shortcuts re-registered');

				// console.log(
				// 	'[PermissionMonitor] ✅ Fn keys are now operational! (latency: ~' +
				// 		(attempt * 100) +
				// 		'ms)',
				// );

				reinitializeInProgress = false;
				return Ok(undefined);
			} catch (error) {
				console.error(
					'[PermissionMonitor] ✗✗✗ Unexpected error during reinitialize:',
					error,
				);
				reinitializeInProgress = false;
				return PermissionMonitorErr({
					cause: error as Error,
					context: { error },
					message: `Unexpected error: ${extractErrorMessage(error)}`,
				});
			}
		},

		/**
		 * Checks permission status and triggers reinitialize if permission was just granted
		 */
		async checkPermissionChange(): Promise<void> {
			const { data: isGranted, error } =
				await this.checkAccessibilityPermission();

			if (error) {
				console.error('[PermissionMonitor] Error checking permission:', error);
				return;
			}

			const currentStatus: PermissionStatus = isGranted ? 'granted' : 'denied';

			// DEBUG: Log every check to see if it's actually running
			// console.log(
			// 	`[PermissionMonitor] 🔍 Check: previous=${previousStatus}, current=${currentStatus}, reinitInProgress=${reinitializeInProgress}`,
			// );

			// Detect permission state changes
			if (previousStatus === 'granted' && currentStatus === 'denied') {
				console.warn(
					'[PermissionMonitor] ⚠️ Accessibility permission was REVOKED! Fn keys will not work until permission is re-granted.',
				);
				// Reset reinitialize flag so subsequent re-grant can trigger new attempt
				reinitializeInProgress = false;
				onRevokedCallback?.();
			}

			// Only reinitialize if permission was explicitly changed from denied -> granted
			// Don't reinitialize on unknown -> granted (app startup with existing permission)
			// as the manager is already initialized during app startup
			if (previousStatus === 'denied' && currentStatus === 'granted') {
				// console.log(
				// 	'[PermissionMonitor] 🎉 Accessibility permission just granted! Reinitializing Fn manager...',
				// );
				// Run reinitialize in background, don't block periodic check
				this.attemptReinitialize();
			}

			previousStatus = currentStatus;
		},

		/**
		 * Starts monitoring accessibility permission changes every 2 seconds
		 */
		async start(): Promise<Result<void, PermissionMonitorError>> {
			if (intervalId !== null) {
				// console.log('[PermissionMonitor] Already started, skipping');
				return Ok(undefined);
			}

			// console.log('[PermissionMonitor] Starting permission monitoring...');

			// Initial check
			await this.checkPermissionChange();

			// Set up periodic monitoring
			intervalId = setInterval(() => {
				this.checkPermissionChange();
			}, 2000);

			// console.log('[PermissionMonitor] ✓ Permission monitoring started');
			return Ok(undefined);
		},

		/**
		 * Stops the permission monitoring
		 */
		stop(): void {
			if (intervalId !== null) {
				clearInterval(intervalId);
				intervalId = null;
				console.log('[PermissionMonitor] Permission monitoring stopped');
			}
		},
	};
}

export const PermissionMonitorLive = createPermissionMonitor();
