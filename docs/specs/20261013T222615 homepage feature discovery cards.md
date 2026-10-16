# Homepage Feature Discovery Cards (Ask Q&A + Screenshot OCR)

## Goal

Two bold, colorful cards at the bottom of the homepage that introduce Ask Q&A and Screenshot OCR. Each card's CTA opens a short, self-contained tutorial dialog that lets the user actually trigger the real feature (not a fake simulation), with PostHog tracking for tutorial start/complete. Users can close the dialog at any time with zero friction.

## Key existing facts (confirmed in codebase, no guessing)

- Both features already have default global shortcuts set: Ask = `Control+Option+Space` (`shortcuts.global.askOverlay`), OCR = `Command+Option+T` (`shortcuts.global.extractTextFromClipboard`). Defined in `apps/whispering/src/lib/settings/settings.ts:246-253`. **No shortcut changes needed** — we just display whatever the user currently has configured, same as onboarding already does.
- The dynamic-shortcut-display pattern already exists in `apps/whispering/src/lib/components/onboarding/UsageGuideScreen.svelte:23-31`: reads from `settings.value['shortcuts.global.X']`, splits on `+`, renders each key via `Keycap.svelte`. We reuse this pattern and the `Keycap` component.
- Real success signals already exist and fire today:
  - Ask: `analytics.trackAskAnswerReceived(...)` in `apps/whispering/src/lib/query/commands.ts:~819` area (right after `trackAskQuestionAsked`).
  - OCR: `analytics.trackOcrSucceeded(...)` in `apps/whispering/src/lib/commands.ts:29` (inside `extractTextFromClipboard`).
  We hook tutorial-completion detection off these real events instead of inventing fake "mark as done" buttons.
- PostHog goes through the `analytics` wrapper object in `apps/whispering/src/lib/services/posthog.ts` (not raw `posthog.capture` calls). New events follow the existing `trackX` naming convention there.
- Homepage bottom section is `apps/whispering/src/routes/+page.svelte` (plain `flex flex-col items-center gap-*` stack, `max-w-6xl`, no grid). New section appends after the existing recordings/shortcuts block (~line 456).
- No existing `FeatureCard`/`ShowcaseCard` component — building one fresh, kept small.
- Onboarding's own store (`apps/whispering/src/lib/stores/onboarding.svelte.ts`) is a tiny 39-line Svelte 5 rune store (`$state` + get/set + methods). New tutorial-tracking store follows the same minimal shape.

## Design

- **Ask Q&A card**: one dominant accent (indigo/violet). Title, one-line description, small visual preview (mic + chat bubble style), CTA "Try asking a question".
- **Screenshot OCR card**: one dominant accent (amber/orange). Title, one-line description, small visual preview (screenshot + extracted text style), CTA "Try extracting text".
- Cards sit side by side on wider screens, stacked on narrow: `grid grid-cols-1 sm:grid-cols-2 gap-4 w-full` row appended to the homepage's existing `max-w-6xl` container.
- Subtle hover state (slight lift/glow in the card's accent color), matches existing app's "premium macOS" feel. No new wrapper divs beyond what's needed (styling best practice).

## Plan (todo)

- [x] Add `apps/whispering/src/lib/stores/feature-tutorial.svelte.ts`: tiny rune store with `activeFeature: 'ask' | 'ocr' | null`, `start(feature)`, `complete(feature)`, `clear()`. Mirrors `onboarding.svelte.ts` style.
- [x] Add 4 tracking methods to `apps/whispering/src/lib/services/posthog.ts` next to the existing Ask/OCR methods: `trackAskTutorialStarted()`, `trackAskTutorialCompleted()`, `trackOcrTutorialStarted()`, `trackOcrTutorialCompleted()`.
- [x] In `apps/whispering/src/lib/query/commands.ts`, right after the existing `analytics.trackAskAnswerReceived(...)` call: if `featureTutorial.activeFeature === 'ask'`, call `featureTutorial.complete('ask')` (one `if` line, no restructuring).
- [x] In `apps/whispering/src/lib/commands.ts`, right after the existing `analytics.trackOcrSucceeded(...)` call inside `extractTextFromClipboard`: if `featureTutorial.activeFeature === 'ocr'`, call `featureTutorial.complete('ocr')` (one `if` line).
- [x] Add `apps/whispering/src/lib/components/FeatureIntroCard.svelte`: small presentational component. Props: `title`, `description`, `variant: 'ask' | 'ocr'`, `ctaLabel`, `icon`.
- [x] Add `apps/whispering/src/lib/components/AskTutorialDialog.svelte`: self-contained (own `open` state), renders `FeatureIntroCard` as its `Dialog.Trigger`. On open: `featureTutorial.start('ask')` + `analytics.trackAskTutorialStarted()`. Shows the live shortcut via `Keycap` (reused from onboarding) and a short instruction ("press this, then ask anything out loud"). Watches `featureTutorial` for completion of `'ask'` and swaps to a short success state. Closes anytime via standard Dialog close (X / overlay / Escape) — on close, `featureTutorial.clear()`.
- [x] Add `apps/whispering/src/lib/components/OcrTutorialDialog.svelte`: same pattern for OCR, instruction is "copy a screenshot, then press this".
- [x] Edit `apps/whispering/src/routes/+page.svelte`: append the two-card grid section after the existing bottom block. Just `<AskTutorialDialog />` and `<OcrTutorialDialog />` — zero state lives on the page itself (self-contained component pattern).

## Non-goals / explicitly out of scope

- No changes to default shortcut keybindings (they're already set and work).
- No changes to the existing first-run `OnboardingFlow` dialog step sequence; these cards live permanently on the homepage, not inside the one-time onboarding flow.

## Review

Implemented exactly per plan, no scope creep.

**New files:**
- `lib/stores/feature-tutorial.svelte.ts` — 29-line rune store, same shape as `onboarding.svelte.ts`.
- `lib/components/FeatureIntroCard.svelte` — presentational card, one accent object (`ask` = indigo, `ocr` = amber) keyed by a `variant` prop.
- `lib/components/AskTutorialDialog.svelte` / `OcrTutorialDialog.svelte` — each self-contained: owns its own `open` state, renders `FeatureIntroCard` inside `Dialog.Trigger`, reads its shortcut live from `settings.value['shortcuts.global.X']` (defaults already existed, nothing changed there), reuses the existing `Keycap` component from onboarding to render it.

**Changed files (33 lines total across 4 files):**
- `lib/services/posthog.ts` — 4 new tracking methods, same shape as existing `trackAsk*`/`trackOcr*` methods.
- `lib/query/commands.ts` + `lib/commands.ts` — one `if` line each, hooked onto the *existing* real success events (`trackAskAnswerReceived`, `trackOcrSucceeded`) rather than inventing fake completion signals. This means "completed" only fires when the user actually asked a real question and got a real answer, or actually extracted real text — not a self-reported "I did it" click.
- `routes/+page.svelte` — 2 import lines + a 5-line grid block (`<AskTutorialDialog />` / `<OcrTutorialDialog />`) dropped in after the existing recordings/shortcuts section, inside the same `max-w-6xl` authenticated-view container. Zero new state on the page itself.

**Verified:** `bun run check` in `apps/whispering` shows 70 pre-existing baseline errors unrelated to this change (transcription settings types, a test route, a table column-meta type) — confirmed via diff that none of them touch any file this feature added or edited. No new type errors introduced.

**Not done / deliberately skipped:** no shortcut rebinding (both features already had working defaults, confirmed before writing any code), no changes to the first-run `OnboardingFlow` dialog.

## Round 2 (post-feedback)

User tested the build and raised two things:

1. Cards sat at the very bottom, below the recordings table — needed a scroll to see them at all.
2. Once a feature's tutorial is actually completed, the card should go away for good instead of sitting there forever.

Changes:
- [x] Moved the cards from the bottom of the page to right after the main recorder card (above the recordings table), so they're visible without scrolling. Reworked `FeatureIntroCard` from a tall vertical card to a compact horizontal row (icon left, title/description middle, CTA right, ~56px tall) so two of them stacked there don't push the recordings table down much.
- [x] Added two persisted settings keys (`onboarding.askTutorialCompleted`, `onboarding.ocrTutorialCompleted`, both `z.boolean().default(false)`) in `settings.ts`, same pattern as the existing `onboarding.*` flags.
- [x] `AskTutorialDialog`/`OcrTutorialDialog` now call `settings.updateKey(...)` to flip that flag to `true` the moment the dialog closes after a real completion (not in-memory only — survives app restart).
- [x] `+page.svelte` wraps each card in its own `{#if !settings.value['onboarding.xTutorialCompleted']}`, and the whole row in an outer `{#if}` so it collapses to nothing once both are done.
