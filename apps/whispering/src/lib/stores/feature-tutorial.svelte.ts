// Tracks which homepage feature-discovery tutorial (Ask Q&A, Screenshot OCR)
// is currently open, so the real success event each feature already fires
// (ask_answer_received, ocr_succeeded) can be recognized as "tutorial
// completed" without inventing a fake "mark as done" button.
export type FeatureTutorialId = 'ask' | 'ocr';

const state = $state<{
	activeFeature: FeatureTutorialId | null;
	completedFeature: FeatureTutorialId | null;
}>({
	activeFeature: null,
	completedFeature: null,
});

export const featureTutorial = {
	get activeFeature() {
		return state.activeFeature;
	},
	get completedFeature() {
		return state.completedFeature;
	},
	start(feature: FeatureTutorialId) {
		state.activeFeature = feature;
		state.completedFeature = null;
	},
	complete(feature: FeatureTutorialId) {
		if (state.activeFeature !== feature) return;
		state.completedFeature = feature;
	},
	clear() {
		state.activeFeature = null;
		state.completedFeature = null;
	},
};
