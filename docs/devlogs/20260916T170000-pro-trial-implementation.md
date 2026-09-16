# Devlog: 7-Day Pro Trial + Feature Gating Implementation

**Date:** 2026-09-16
**Spans two repos:** `whisper-2` (this repo, desktop app) and `noteflux--` (website, `/Users/priyesh/Desktop/noteflux--`)
**Companion doc:** `docs/specs/20260916T160000-pro-trial-and-feature-gating.md` — the design/plan; this file is the "what actually happened, in what order, and why" log for debugging later.

Purpose of this file: if something in the trial/gating system breaks later, this is the record of every change made in this pass, grouped by milestone, with the reasoning behind each one — so a future debugging session can find the exact commit-worthy change and the "why" without re-deriving it from a long chat history.

---

## Milestone 1 — Derived subscription state (`isPro`, `isTrialActive`, `hasProAccess`)

**Files:** `apps/whispering/src/lib/services/subscription/dodo.ts`, `apps/whispering/src/lib/stores/subscription.svelte.ts`

Added `trialEndsAt: string | null` to the `SubscriptionStatus` type and to `fetchSubscriptionStatus()`'s parsed response. Added three new getters to the exported `subscription` store object:

- `isTrialActive` — `trialEndsAt !== null && Date.now() < new Date(trialEndsAt).getTime()`
- `trialDaysLeft` — ceil of remaining ms / day, floored at 0
- `hasProAccess` — `this.isPro || this.isTrialActive`

**Why three states and not just reusing `isPro`:** a trial needed to grant the same feature access as a real subscription, but *not* be indistinguishable from one. Two concrete bugs would have resulted from collapsing them: (1) `ProPricingDialog`'s "Get Pro" button already disables itself when `isPro` is true — a trial user who wants to subscribe early would find the button unclickable; (2) the website's "Manage subscription" button (opens the Dodo customer portal) shows whenever `isPro` is true — a trial user has no real Dodo customer record, so that lookup would fail. Keeping `isPro` strictly meaning "real, paid, webhook-confirmed" avoids both.

**Why `trialEndsAt` is a separate field, not reusing `subscription_period_end`:** the real-subscription update path (`updateUserSubscription()` in the website's `lib/services/dodo.ts`) has a stale-webhook guard that rejects updates with an *older* `period_end` than what's already stored. A 7-day trial's end date could easily be later than a freshly-purchased monthly subscription's `period_end` — reusing the field risked a real purchase's webhook getting silently rejected as "stale" when it wasn't. Separate field, separate concern, no collision possible.

---

## Milestone 2 — Website: exposing `trial_ends_at` through the status API

**Files:** `noteflux--/lib/services/dodo.ts`

`getSubscriptionStatus()` now also selects `trial_ends_at` from the `users` table and returns it as `trialEndsAt` in the response. `app/api/subscription/route.ts` needed no changes — it already just JSON-serializes whatever `getSubscriptionStatus()` returns, so the new field passes through automatically.

`app/pricing/page.tsx`'s `isPro` computation was checked and left untouched — it already computes `tier === "pro" && isActive`, which trial deliberately never touches (trial doesn't write `subscription_tier` at all). Confirmed this means the website's Pro/free display is unaffected by trial state without any code change, which is exactly the point of keeping trial state in its own column.

---

## Milestone 3 — Cloud transcription gate (silent fallback to local)

**Files:** `apps/whispering/src/lib/query/transcription.ts`

Inside the `case 'Groq':` branch of the transcription-provider switch, added a check: if `!subscription.hasProAccess`, call the local Qwen3-ASR service (`DEFAULT_QWEN3_ASR_MODEL_ID`) instead of Groq — same function signature shape, just a different provider, no error surfaced to the user.

**Why silent, no dialog/toast:** this code path runs on *every single transcription*. Interrupting with a dialog or even a toast every time someone dictates would be immediately unbearable. The only interruption for this feature is the one-time post-trial dialog (milestone 6) — after that, it's just a quiet, permanent fallback.

**Known follow-up not done here:** the pre-existing `total_usage_limit` 2000-minute cap check (further up in the same file, from an earlier session) is now effectively dead code for anyone who reaches the Groq branch, since reaching it already implies `hasProAccess`. Left untouched rather than removed, to keep this change scoped — flagging it here so it doesn't get mistaken for intentional redundancy later.

---

## Milestone 4 — Transformation execution gate (default + custom, same gate)

**Files:** `apps/whispering/src/lib/query/commands.ts`

The post-transcription flow already had a branch: `if (!transformationId || hasSelectionContext) { deliver raw text }`. Added `|| !subscription.hasProAccess` to that same condition — so a blocked user's transcript just delivers raw, exactly as if no transformation were selected.

**Why the default transformation is gated too, not just custom ones:** this was a genuine correction mid-conversation. The default auto-cleanup transformation (auto-created for every new user in `setup-default-transformation.ts`, unrelated file, not touched here) makes a real Groq LLM call on every transcription, same cost shape as cloud transcription itself. Initially reasoned about it like `Dictionary` (an old, zero-cost, "don't retroactively yank it" feature) — but that reasoning only checked the *age* argument, not the *cost* argument, and unlike Dictionary (client-side, $0/use) the default transformation costs real money per use, silently, uncapped, forever. Once that inconsistency was pointed out, the default transformation was folded into the same `hasProAccess` gate as custom transformations rather than getting a special exemption.

**Simplified from the original plan:** `TransformationSelector.svelte` (the picker UI) was not touched — locked transformations can still be selected in the UI, they just won't execute. The plan called for lock icons + a "Pro" badge directly in the selector; not built this pass, noted as a deferred follow-up in the spec doc. The functional gate (execution) is what matters for correctness; the selector polish is cosmetic on top of that.

---

## Milestone 5 — Inline Edit gate (toast, not silent)

**Files:** `apps/whispering/src/lib/query/delivery.ts`

Added a check at the top of the `hasSelection && selectionContext` branch (the inline-edit code path): if `!subscription.hasProAccess`, show a `notify.warning` toast ("🔒 This is a Pro feature") with a button action that opens `proPricingDialog`, and return early instead of running the Groq completion call.

**Why a toast here and silent everywhere else:** Inline Edit is a *deliberate* action — the user selects text, holds Fn, and speaks specifically to invoke this feature. Unlike cloud transcription or auto-cleanup (which fire automatically on every transcription regardless of intent), a blocked attempt here is the user actively trying something and it not working — silence would just look broken. A toast explains why, without escalating to a modal dialog every time (that repeat-modal pattern was explicitly the thing to avoid, per milestone 6).

---

## Milestone 6 — Post-trial dialog (shown exactly once)

**New files:** `apps/whispering/src/lib/stores/post-trial-dialog.svelte.ts`, `apps/whispering/src/lib/components/subscription/PostTrialDialog.svelte`
**Modified:** `apps/whispering/src/lib/settings/settings.ts` (new key `app.trialEndedNoticeShown`), `apps/whispering/src/routes/+layout.svelte` (trigger effect + component mount)

The store follows the exact same open/close pattern as the existing `pro-pricing-dialog.svelte.ts`, for consistency. The dialog itself mirrors `SignupRequiredDialog`'s structure and button sizing (narrow, centered buttons — matches a design fix made earlier in this same conversation for that dialog).

Trigger logic in `+layout.svelte`: an effect that fires when `subscription.isKnown && !isPro && !isTrialActive && state.trialEndsAt !== null && !settings['app.trialEndedNoticeShown']`. Sets the flag to `true` immediately on open, so it can only ever fire once per install.

**Why this exact condition, not simpler:** `trialEndsAt !== null` specifically distinguishes "had a trial and it ended" from "never had a trial" (e.g. an account created before this system existed) — without that check, every existing free account would get the dialog on next launch, which is wrong; there was nothing to end for them.

**This is the *only* full-modal interruption in the entire system.** Every other blocked-feature moment (cloud, transformations, inline edit) deliberately never reopens a dialog — see "Repeat-block messaging" in the spec doc for the reasoning (loss-aversion conversion psychology: one real "you lost this" moment converts better than repeated nagging).

---

## Milestone 7 — Sidebar / AuthSection trial badge

**Files:** `apps/whispering/src/lib/components/Sidebar.svelte`, `apps/whispering/src/lib/components/auth/AuthSection.svelte`

Added a fourth branch to the existing `{#if isPro}...{:else if isConfirmingCheckout}...{:else if canSubscribe}` chain in both files: `{:else if isKnown && isTrialActive}`, placed *before* the `canSubscribe` branch.

**Why the ordering matters:** `canSubscribe` is derived as `isAuthenticated && isKnown && !isPro` — a trial-active user has `isPro === false` by design (milestone 1), so without the trial branch coming first in the if-chain, they'd fall through to the generic "Get Pro" button instead of seeing trial-specific messaging.

Badge styling: same bordered-pill shape as the existing Pro/Get-Pro states (no icon — matches the icon-removal cleanup done earlier this session), gradient "Pro trial" text, muted "X days left" secondary text, switching to amber + "ends tomorrow" when `trialDaysLeft <= 1`. Clicking it reuses the existing `onGetProClick` handler (same one the "Get Pro" button already used), so it opens `proPricingDialog` — letting someone convert early mid-trial with zero new interaction code.

---

---

## Milestone 8 — Website: trial state actually shown in the UI (follow-up, separate session)

**Files:** `noteflux--/lib/services/dodo.ts`, `noteflux--/app/pricing/page.tsx`, `noteflux--/components/pricing/pricing-cards.tsx`, `noteflux--/components/header-auth.tsx`

Milestone 2 exposed `trialEndsAt` through `getSubscriptionStatus()`, but nothing on the website actually *read* it — `/pricing`'s `PricingCards` only ever took an `isPro` boolean, and `header-auth.tsx` (the nav shown on every page) had zero subscription-status indication at all: a Pro subscriber, a mid-trial user, and a plain free user all saw an identical header. Verified this gap directly against the actual current code (not assumed) before fixing.

Added a shared `deriveTrialState()` helper next to `SubscriptionStatus` in `lib/services/dodo.ts` (same `isTrialActive`/`trialDaysLeft` math as `whisper-2`'s `subscription.svelte.ts`, kept in one place instead of duplicated across the two website call sites).

`PricingCards` now takes `isTrialActive`/`trialDaysLeft` props. Deliberately did **not** replace the "Get Pro" button with a disabled/different state during a trial — same reasoning as the spec doc's Milestone 1 (a trial user must still be able to subscribe early). Instead, a small "Pro trial — X days left" line renders above the unchanged, still-fully-functional "Get Pro" button, switching to amber "ends tomorrow" on the last day.

`header-auth.tsx` now fetches `getSubscriptionStatus()` for the logged-in user and shows the same 3-state badge (Pro / trial countdown / nothing) next to "Hello, {email}!" — mirrors the desktop Sidebar/AuthSection pattern, but this is the *only* surface on the website showing status outside `/pricing` itself, so it was the bigger gap of the two.

Verified: `tsc --noEmit` clean, `/pricing` and `/` both load without error in a local dev smoke test.

---

## What's explicitly not done — see "Still to do" in the spec doc for the full list

The short version: (1) the actual Supabase `ALTER TABLE` to add `trial_ends_at` hasn't been run — no safe programmatic path was available (no `pg` package, no direct Postgres connection string in either repo's `.env`, and a production schema change isn't something to script around blindly), so the exact SQL is documented in the spec doc for manual execution; (2) the four purchase-during-trial scenarios are specced but not yet manually tested end-to-end; (3) `TransformationSelector.svelte`'s lock-icon UI polish; (4) a quiet backend abuse ceiling on trial cloud usage.

## Verification performed

`bunx svelte-check` run after every file group above, not just at the end. Final full pass: 71 errors total, matching the known pre-existing baseline from before this session's work started (confirmed by grepping the output for every file touched in this pass — zero of the 71 belong to any of them, except one pre-existing, unrelated `OnboardingStep` type mismatch in `commands.ts` at a line this pass never touched).
