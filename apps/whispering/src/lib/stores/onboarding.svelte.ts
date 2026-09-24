type OnboardingStep =
	| 'welcome'
	| 'permissions'
	| 'usage-guide'
	| 'inline-edit'
	| 'choice'
	| 'complete';

type OnboardingState = {
	isOpen: boolean;
	currentStep: OnboardingStep;
};

const state = $state<OnboardingState>({
	isOpen: false,
	currentStep: 'welcome',
});

export const onboardingStore = {
	get isOpen() {
		return state.isOpen;
	},
	set isOpen(value: boolean) {
		state.isOpen = value;
	},
	get currentStep() {
		return state.currentStep;
	},
	set currentStep(value: OnboardingStep) {
		state.currentStep = value;
	},
	openAt(step: OnboardingStep) {
		state.currentStep = step;
		state.isOpen = true;
	},
	close() {
		state.isOpen = false;
	},
};
