import confetti from 'canvas-confetti';

// Dedicated canvas above the onboarding dialog (z-index 9999) — the default
// confetti canvas renders underneath it.
export function celebrate(options: { particleCount?: number; originY?: number } = {}) {
	if (typeof document === 'undefined') return;
	const canvas = document.createElement('canvas');
	canvas.style.cssText =
		'position:fixed;inset:0;width:100%;height:100%;z-index:99999;pointer-events:none';
	document.body.appendChild(canvas);

	const fire = confetti.create(canvas, { resize: true });
	fire({
		colors: ['#4ade80', '#22c55e', '#a7f3d0', '#ffffff', '#86efac'],
		origin: { y: options.originY ?? 0.6 },
		particleCount: options.particleCount ?? 110,
		spread: 75,
	});

	setTimeout(() => canvas.remove(), 3000);
}
