# 7-Day Pro Trial + Proper Feature Gating (Transformations, Inline Edit, Cloud)

**Created:** 2026-09-16
**Status:** Implemented (application code). One manual step remains — see "Still to do" at the bottom.

## Confirmed: free-tier redefinition

This changes something decided earlier in the same conversation, explicitly confirmed before implementing:

- **Before:** Free = unlimited local + 2000 free lifetime minutes of cloud transcription + Dictionary. Cloud stayed usable (capped) forever on Free, no trial needed for basic cloud access.
- **Now, confirmed and shipped:** Free = unlimited local **only**. Cloud transcription (and all AI features — auto-cleanup, custom transformations, inline edit) require **Pro or an active trial**, full stop. No permanent free cloud tier survives. The only way a free-tier user ever sees cloud transcription or AI features is during the one-time 7-day trial.

## Goal

1. Every new signup gets a 7-day trial with full Pro access (unlimited cloud, auto-cleanup, custom transformations, inline edit) — automatic, no card, no click to activate.
2. When the trial ends, cloud transcription and all AI features stop working; local models keep working unlimited, forever, for everyone, always (unchanged from the existing decision — already shipped in `transcription.ts`'s `isLocalService` exemption, predates this doc).
3. A dismissible, one-time dialog explains this the next time the app opens after the trial ends.
4. None of this breaks or complicates an actual real Dodo purchase, whether it happens during the trial, right after it ends, or any time later.

## Data model (Supabase `users` table)

New column: **`trial_ends_at timestamptz`**, set once at account creation, never touched again after that.

**Deliberately kept separate from `subscription_tier` / `subscription_id` / `subscription_period_end`.** Reusing the real subscription fields for trial state was considered and rejected — concrete reason: `updateUserSubscription()` in `noteflux--`'s `lib/services/dodo.ts` has a stale-webhook guard that refuses to let an older `period_end` overwrite a newer one. A trial's 7-day `period_end` could easily be later than a freshly-purchased monthly subscription's `period_end` if someone subscribes for real mid-trial — reusing the same field risks a real webhook getting silently rejected as "stale" when it isn't. Keeping trial state in its own column sidesteps this category of bug entirely.

**Decided: set via a Supabase column default, not application code** — `default now() + interval '7 days'`. Reasoning: there are multiple ways an account gets created (email/password, OAuth, future methods, desktop vs. website), and if application code were responsible for setting this, any one of those paths could forget it, including ones added later. A database-level default applies automatically the instant any row is inserted, regardless of which code path created it, so it can't be missed — less work than the alternative too, not just more reliable.

## Derived states (`whisper-2`'s `subscription.svelte.ts`, mirrored in `noteflux--`'s `getSubscriptionStatus()`)

Three states, not one, because collapsing them into a single `isPro` boolean is exactly what causes the two real bugs below:

- **`isPro`** — real, paid subscription. `tier === 'pro' && isActive` (unchanged, existing logic).
- **`isTrialActive`** — `trial_ends_at !== null && now < trial_ends_at`.
- **`hasProAccess`** — `isPro || isTrialActive`. This is the one every feature gate actually checks (cloud transcription, transformations, inline edit) — not `isPro` directly.

**Why not just make trial flip `isPro` to true directly?** Two concrete breakages if you do:
1. The "Get Pro" button in `ProPricingDialog.svelte` disables itself and shows "You're already Pro" when `subscription.isPro` is true. If trial sets `isPro = true`, someone who wants to actually subscribe *during* their trial (the highest-intent moment there is) physically can't click the button.
2. `app/pricing/page.tsx` on the website shows "Manage subscription" (opens the Dodo customer portal) whenever `isPro` is true. A trial user has no real Dodo customer record — that portal lookup would just fail.

**Display priority when both could be true at once (someone subscribes for real while their trial is still active): `isPro` always wins, instantly.** Feature access doesn't change either way (`hasProAccess` already covers both), but the Sidebar/AuthSection badge must switch to plain "Pro" (no countdown) the moment the webhook confirms the real subscription — not wait until the original `trial_ends_at` date. Showing trial-countdown messaging to someone who already paid is wrong. Check order: `isPro` → "Pro". Else `isTrialActive` → "Pro trial — X days left". Else → "Get Pro".

## Feature gates — implemented

| Feature | File | Change | When blocked |
|---|---|---|---|
| Cloud transcription (Groq) | `apps/whispering/src/lib/query/transcription.ts` | Silently falls back to the local model (`DEFAULT_QWEN3_ASR_MODEL_ID`) when `!subscription.hasProAccess`, instead of calling Groq. | Silent — no dialog, no toast. Fires on every transcription; any interruption here would be spam. |
| Default + custom transformations | `apps/whispering/src/lib/query/commands.ts` | Transformation execution (the auto-run-after-transcription path) now requires `subscription.hasProAccess`; falls back to raw-text delivery otherwise, same as having no transformation selected at all. | Silent — same reasoning as cloud, fires every transcription. |
| Inline Edit | `apps/whispering/src/lib/query/delivery.ts` | Before the Groq completion call fires, checks `subscription.hasProAccess`. If false, shows a toast instead of running the edit. | Toast (`notify.warning`, button action opens `proPricingDialog`) — deliberate user action (select text, hold Fn, speak), so a lightweight nudge is fair. Never a repeat modal. |

**Simplified from the original plan, noted honestly:** the plan called for lock icons + a "Pro" tag directly in `TransformationSelector.svelte` for locked custom transformations. Not built this pass — selecting a transformation in the UI still always works; only *execution* is gated (in `commands.ts`). A free/lapsed-trial user can still browse and select transformations, they just silently don't run. Visual lock-icon polish in the selector is a deferred follow-up, not required for the gate itself to work correctly.

### Repeat-block messaging — the full paywall dialog is shown exactly once

The full `proPricingDialog` modal only ever appears once: the post-trial dialog, triggered on the first app-open after `trial_ends_at` passes. Every blocked attempt *after* that — whether silent (cloud/transformations) or a toast (inline edit) — never re-opens that modal. The Sidebar's persistent trial/Pro badge is the only always-available, non-intrusive path back to upgrading.

## Post-trial dialog — implemented

New files: `stores/post-trial-dialog.svelte.ts` (open/close store, same pattern as `pro-pricing-dialog.svelte.ts`), `components/subscription/PostTrialDialog.svelte` (dialog UI). Trigger effect added to `routes/+layout.svelte`:

```
subscription.isKnown && !isPro && !isTrialActive && state.trialEndsAt !== null && !settings['app.trialEndedNoticeShown']
```

`app.trialEndedNoticeShown` is a new local settings key (`settings/settings.ts`) — a UI nag flag, not billing state. Set to `true` the instant the dialog opens, so it only ever fires once per install. Dismissible — "Continue with Free" just closes it, no forced action.

## Sidebar / AuthSection trial indicator — implemented

Fourth state added to the existing `{#if}` chain in both `Sidebar.svelte` and `AuthSection.svelte` (same footer slot as "Pro"/"Get Pro"/"Confirming payment", no new UI surface), keyed off `subscription.isTrialActive`, placed *before* the plain "Get Pro" branch so it takes priority (a trial user still has `isPro === false`, so without this ordering they'd fall through to the generic button).

- Matching pill badge style (no icon, per the earlier cleanup pass). Gradient "Pro trial" text + muted "X days left".
- Clickable — reuses the existing `onGetProClick` handler, opens `proPricingDialog`.
- Color shift: emerald while `trialDaysLeft > 1`, amber + "ends tomorrow" copy on the last day.
- Collapsed sidebar: falls back to just "Xd" instead of the full label, matching the existing collapsed-mode pattern for the other footer states.

## Making sure a real Dodo purchase never breaks, whatever the trial state

Specced, not yet manually tested end-to-end (needs a real signup → trial → checkout run, not just code review):

1. **Subscribing during an active trial.** Checkout creation only looks at real Dodo state (the duplicate-subscription guard checks `customers.list`/`subscriptions.list`, which a trial user won't have any of), so it should pass through cleanly. Should verify: session creates, webhook fires, `isPro` flips true, independent of `trial_ends_at`.
2. **Subscribing right after trial ends.** Post-trial dialog's "Get Pro" button routes into the exact same checkout flow — no special-cased trial path.
3. **Website pricing page during an active trial.** `isPro` stays false (correct — no real subscription), shows normal "Get Pro" CTA, not "Manage subscription".
4. **A trial user who never subscribes, months later, finally does.** Completely normal checkout flow, nothing trial-related in the code path.

## Still to do

1. **Supabase migration — done.** Run manually in the SQL editor (no `pg` client or direct Postgres connection was available in either repo to script it):
   ```sql
   ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz DEFAULT (now() + interval '7 days');
   ```
   Note: existing rows (if any real accounts exist) got the default evaluated once at ALTER-time, not backdated to their actual signup date — everyone existing effectively got a fresh 7-day trial starting from when this ran. Given "nobody's using the app consistently right now," this was judged low-stakes and not worth extra migration complexity to avoid.
2. **Manual end-to-end test of the 4 purchase-during-trial scenarios above** — not yet run against a real trial account.
3. **Lock-icon UI polish in `TransformationSelector.svelte`** — deferred, noted above.
4. **Trial abuse ceiling** (quiet backend cap on cloud usage during trial, discussed earlier in the conversation, never specced in detail) — deliberately deferred; current judgment is real abuse cost is low enough (a determined abuser costs tens of dollars, not a threat at current scale) to watch via analytics rather than pre-build for.
