/**
 * Global store for the Pro paywall dialog, so any entry point (sidebar,
 * auth section, post-signup chain from SignupRequiredDialog) can open the
 * same single dialog instance instead of each mounting its own.
 */

let isOpen = $state(false);

export const proPricingDialog = {
	get isOpen() {
		return isOpen;
	},

	set isOpen(value: boolean) {
		isOpen = value;
	},

	open() {
		isOpen = true;
	},

	close() {
		isOpen = false;
	},
};
