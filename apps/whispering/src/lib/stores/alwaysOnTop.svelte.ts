let alwaysOnTopSuspended = $state(false);

export function setAlwaysOnTopSuspended(suspended: boolean) {
	alwaysOnTopSuspended = suspended;
}

export function isAlwaysOnTopSuspended() {
	return alwaysOnTopSuspended;
}