# Anonymous 7-Day Pro Trial (replaces onboarding demo credits)

**Date**: 2026-09-25 (rewritten to match corrected CONTEXT)
**Branch**: `feat/onboarding-pro-demo-redesign`
**Status**: SUPERSEDED (2026-09-25, same day) — see "Milestone: Full reversal" near the
bottom. Everything below this notice (the device-bound anonymous trial, Keychain →
IOPlatformUUID, `AnonymousTrialEndedDialog`) was built, then reverted, in favor of a
simpler design: signup moves back to the **last onboarding step** (not deferred to day
7), the onboarding demo (2 actions: dictation + inline-edit) works for an anonymous
session via a **plain step check, no credits, no device tracking, no persisted trial
at all**. Kept below as a record of what was tried and why it didn't stick — the
reasoning in the reversal milestone is what's actually live in the code now.

> Correction applied: the trial is **7 days**, not 14; and `use_onboarding_demo_credit`
> **does exist live** (my earlier plan draft wrongly claimed 404 — that was from calling
> it with `{}` instead of the real `p_user_id` arg). Verified below.

## Live Supabase state (verified 2026-09-25 via REST with service-role key)

- `use_onboarding_demo_credit(p_user_id uuid, p_limit integer)` **EXISTS and runs** —
  direct RPC call with a bogus UUID returned `{"code":"23503", ... "not present in table users"}` (HTTP 409).
  Signature confirmed from the PostgREST OpenAPI spec (`p_user_id` required uuid, `p_limit` integer).
- `users.onboarding_demo_credits_used` column **EXISTS** (REST select returns `0`).
- `users.trial_ends_at` column **EXISTS** (real-signup trial path; untouched).
- Project: `https://yequtdwevbzqslicghvx.supabase.co`; service-role key in `/Users/priyesh/Desktop/noteflux--/.env`.
- No Keychain-adjacent code exists anywhere in `src-tauri/` (grepped `security-framework|keyring|Keychain` — zero hits). New Rust required.

## DECIDED (build exactly this)

1. Anonymous session created at onboarding start (`auth.signInAnonymously()` in `OnboardingFlow.svelte` onMount) auto-gets a **7-day Pro trial**. No signup required.
2. **Full Pro access** during those 7 days — cloud transcription (Groq), AI inline-edit, auto-cleanup — **no usage cap of any kind**. Anonymous-in-trial treated identically to a real trial user everywhere access is checked.
3. Abuse control: trial binds to a **persistent hardware device UUID** — `IOPlatformUUID`, not Keychain (see corrected item 2 below: Keychain triggers a permission dialog, rejected as too risky for a cold first-run) — one trial per device, not per disposable anonymous account; survives uninstall/reinstall; does NOT survive a new macOS user/VM — documented limitation.
4. `subscription.hasProAccess` must become true for anonymous-in-trial via the **existing `isTrialActive`/`trialDaysLeft` getters** — no parallel property. Sidebar `{:else if subscription.isKnown && subscription.isTrialActive}` badge (Sidebar.svelte:179) must light up with zero new sidebar code.
5. On anonymous trial expiry, surface the **existing `ChoiceScreen.svelte`** in the main app shell (NOT a new screen), with `eyebrow: "Your 7-day Pro trial has ended"`, `headline: "Don't go back to typing."` Everything else in ChoiceScreen stays as-is.
6. **CRITICAL**: `+layout.svelte`'s PostTrialDialog `$effect` (search `trialEndedNoticeShown`) will fire for anonymous users too once `trialEndsAt` is fed for them — add `!auth.isAnonymous` to its condition.
7. **New decision (2026-09-25, this update)**: anonymous access is capped at exactly 7 days *total*, not "7 days of Pro then unlimited-forever-anonymous-local." Once the trial ends, **both** choices — buy Pro, or stay on the free/local tier — require a real account. There is no permanent anonymous-free tier anymore; local transcription is still free forever, but only for a real (non-anonymous) account. This closes the "anonymous free users are unreachable forever, no email, can't re-engage" gap raised earlier this session, at the cost of forcing an account on anyone who wants to keep using the app past a week, even if they never intend to pay. Accepted tradeoff — that segment has near-zero revenue value anyway.
8. **Mechanism correction**: the pre-existing 5-minute `anonymous-gate.ts` check **cannot** enforce #7, because it only ever counts cloud (Groq) minutes (`trackUsage` never fires for local) — a user on pure local transcription after trial expiry would never trip it. The correct check is a **time comparison already available for free**: `auth.isAnonymous && subscription.state.trialEndsAt !== null && !subscription.isTrialActive` (trial existed and has now passed). No new usage counter, no new column — reuse the same `trialEndsAt` the anonymous branch (item below) already fetches. This is folded into `fetchGateStatus()` itself (see file plan below) so every existing call site (`commands.ts` x3) blocks local *and* cloud recording identically once expired, exactly like it already blocks both today once the old 5-min counter trips — that blocking behavior was already generic, only the trigger condition changes.
9. `ChoiceScreen.svelte` gets a `forceSignupOnFree` prop (default `false`). When `true` (trial-expiry context only), `handleUseFree()` calls `auth.signUp()` instead of `goto('/settings/transcription')`. No separate "free signup" vs "Pro signup" distinction is possible or needed server-side — every real signup already gets the same `trial_ends_at = now() + 7 days` DB default regardless of which button was clicked (verified fact, unrelated to intent).

10. **Reversed (2026-09-25, second correction): the end-of-onboarding `choice` step is removed entirely, not reused in place.** It predates this trial rework — it existed because the old demo-credit system gave anonymous users only 5 credits, so a real decision was genuinely due right after the demo. Now anonymous sessions get the full unbounded 7-day trial automatically at onboarding start (see item 1), so by the time onboarding reaches that screen, nothing is actually about to run out — "Start 7-day free trial" would be lying (they're already in it), and forcing the choice there is friction with no remaining reason, contradicting the "let them experience it first" principle this whole redesign was built around. Removed from `OnboardingFlow.svelte`'s step union, `PROGRESS_STEPS`, and `nextStep()` (inline-edit now completes onboarding directly). `ChoiceScreen.svelte` is not deleted — it's still used by `AnonymousTrialEndedDialog` — only its place in the onboarding step sequence is gone. The Sidebar's existing "Pro trial · Xd left" badge + Get Pro button (zero changes, already wired) carries the CTA for the rest of the 7 days; the real, forced choice only happens at trial expiry via `AnonymousTrialEndedDialog`.

## CONCRETE PLAN

### 1. Supabase SQL migration (you run in dashboard SQL editor)

```sql
-- Device-bound anonymous 7-day trial. Row created on first fetch; trial_ends_at
-- is fixed at first call (ON CONFLICT DO NOTHING means reinstalls within the
-- window do NOT extend it, and a new anonymous account does NOT reset it).
create table if not exists public.anonymous_trials (
  device_uuid text primary key,
  trial_ends_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.anonymous_trials enable row level security;

-- SECURITY DEFINER: callers (anonymous session, role 'authenticated') have no
-- direct table access; the definer (owner) bypasses RLS.
create or replace function public.get_anonymous_trial(p_device_uuid text)
returns timestamptz
language sql
security definer
set search_path = public
as $$
  insert into public.anonymous_trials (device_uuid, trial_ends_at)
  values (p_device_uuid, now() + interval '7 days')
  on conflict (device_uuid) do nothing;
  select trial_ends_at from public.anonymous_trials where device_uuid = p_device_uuid;
$$;

revoke execute on function public.get_anonymous_trial(text) from public;
grant execute on function public.get_anonymous_trial(text) to authenticated;

-- Remove obsolete onboarding demo credit system (both verified live).
drop function if exists public.use_onboarding_demo_credit(uuid, integer);
alter table public.users drop column if exists onboarding_demo_credits_used;
```

### 2. Rust: hardware UUID, not Keychain (new file `src-tauri/src/device_id.rs`)

**Reversed from the original plan below.** Keychain access triggers a
macOS "noteflux wants to use your keychain" permission dialog on first
access — on an ad-hoc-signed dev build this can re-prompt on every
rebuild, and even on a properly signed build it's a system dialog most
users have never seen from this app before. Flagged as too risky for a
cold first-run (2026-09-25 correction, after the Keychain version briefly
shipped and prompted immediately on test). Replaced with reading the
Mac's `IOPlatformUUID` — a hardware property, not a TCC-gated resource, so
there is no permission prompt, ever. Same properties that mattered
(survives app reinstall, doesn't survive a clean macOS reinstall/new
user/VM), zero user-facing friction.

```rust
use std::process::Command;

#[tauri::command]
pub fn get_device_uuid() -> Result<String, String> {
    let output = Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .map_err(|e| format!("failed to run ioreg: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .find_map(|line| {
            let line = line.trim();
            line.strip_prefix("\"IOPlatformUUID\" = \"")
                .and_then(|rest| rest.strip_suffix('"'))
                .map(|uuid| uuid.to_string())
        })
        .ok_or_else(|| "IOPlatformUUID not found in ioreg output".to_string())
}
```

- `src-tauri/src/lib.rs`: `#[cfg(target_os = "macos")] mod device_id;` + `use device_id::get_device_uuid;`, registered in the macOS `invoke_handler` list.
- `src-tauri/Cargo.toml`: **no new dependencies** — `std::process::Command` only, no `security-framework`/`uuid` needed (the UUID already comes pre-formatted from `ioreg`).

### 3. New `apps/whispering/src/lib/services/device-id.ts`

`getDeviceUuid(): Promise<string>` — Tauri `invoke('get_device_uuid')`, falling back to localStorage (`noteflux_device_uuid`, `crypto.randomUUID()`) when not running under Tauri (web/dev). Memoize as a cached promise. Static-import `invoke` from `@tauri-apps/api/core` like `analytics.ts:3`.

### 4. `apps/whispering/src/lib/stores/subscription.svelte.ts` (anonymous branch only; real-account logic untouched)

- Change early-return on line 65 from `!user || !accessToken || user.isAnonymous` to `!user || !accessToken`.
- After the `refreshInFlight` guard, add an anonymous branch that mirrors the real branch's shape (stale check + `isConfirmed` semantics), skips the dodo fetch + cache, and instead:

```typescript
const deviceUuid = await getOrCreateDeviceUuid();
const { data, error } = await supabase.rpc('get_anonymous_trial', { p_device_uuid: deviceUuid });
subscriptionState = error
  ? FREE_SUBSCRIPTION
  : { ...FREE_SUBSCRIPTION, trialEndsAt: (data as string) ?? null };
isKnown = true;
```

Then `isConfirmed = true` in `finally`. `isPro` stays false (tier `'free'`), so the Get Pro button stays available. The existing getters `isTrialActive`/`trialDaysLeft`/`hasProAccess` then "just work" — Sidebar badge (Sidebar.svelte:179) lights up for free. Imports: `supabase` from `$lib/services/auth/supabase-client`, `getOrCreateDeviceUuid`.

### 5. Remove the credit system

- Delete `apps/whispering/src/lib/services/onboarding-demo-access.ts`.
- `apps/whispering/src/lib/query/transcription.ts` (lines 11, 339-351): drop the import and the demo-credit comment; replace `await hasEffectiveProAccess(subscription.hasProAccess)` with a plain `subscription.hasProAccess` check. Keeps the silent local fallback for non-Pro.
- `apps/whispering/src/lib/query/delivery.ts` (lines 14, 165-171): same revert to plain `subscription.hasProAccess` (inline-edit gate toast unchanged otherwise).

### 6. `apps/whispering/src/lib/components/onboarding/ChoiceScreen.svelte` (only file touched in `components/onboarding/`)

Add optional props with current values as defaults; markup uses `{eyebrow}`/`{headline}`. Add `forceSignupOnFree?: boolean` (default `false`). `handleUseFree()` branches: when `true`, call `auth.signUp()` + `onNext()` (same shape as `handleStartTrial` minus confetti) instead of `goto('/settings/transcription')`. "Stay on Free" card subtext also branches on the same prop so the copy doesn't imply staying anonymous. Nothing else changes (subhead, pricing, feature list, trust line, `handleStartTrial`).

### 7. New `apps/whispering/src/lib/components/subscription/AnonymousTrialEndedDialog.svelte` (self-contained)

- Opens once when: `auth.isAnonymous && subscription.isConfirmed && !subscription.isPro && !subscription.isTrialActive && subscription.state.trialEndsAt !== null && !settings.value['app.anonymousTrialEndedNoticeShown']` — then sets that flag (mirror of `+layout.svelte` PostTrialDialog effect, own `$state`).
- Renders `Dialog.Root` + `Dialog.Content` wrapping `ChoiceScreen` with `eyebrow="Your 7-day Pro trial has ended"`, `headline="Don't go back to typing."`, `forceSignupOnFree={true}`, `onNext={close}`.
- This dialog is the *proactive* moment (shown once, on next app open after expiry). The *reactive* backstop is item 10 below — if they dismiss this and later try to record anyway, the gate blocks and reopens `signupRequiredDialog` instead.

### 8. `apps/whispering/src/lib/settings/settings.ts`

Add `'app.anonymousTrialEndedNoticeShown': z.boolean().default(false)` next to line 127.

### 9. `apps/whispering/src/routes/+layout.svelte`

- Add `!auth.isAnonymous` to the PostTrialDialog `$effect` condition (lines 44-49). Import `auth` store.
- Render `<AnonymousTrialEndedDialog />` next to `<PostTrialDialog />`.

### 10. `apps/whispering/src/lib/services/anonymous-gate.ts` (rewritten, not just widened)

`fetchGateStatus()` becomes, in order:
1. Not authenticated → `null` (unchanged).
2. Not anonymous (real account) → `{ needsSignup: false, totalMinutes: 0, reason: 'ok' }` (unchanged).
3. Anonymous **and trial has expired** (`subscription.state.trialEndsAt !== null && !subscription.isTrialActive`) → `{ needsSignup: true, totalMinutes: 0, reason: 'trial-expired' }`. This is the new #7/#8 enforcement — blocks local and cloud identically, since all three call sites already gate the entire recording attempt before dispatch, not just the cloud branch.
4. Anonymous **and in an active trial** (`subscription.hasProAccess`) → `{ needsSignup: false, totalMinutes: 0, reason: 'ok' }` — no usage cap during the trial window (item 2).
5. Anonymous, no trial on record at all (race before the trial fetch resolves, or pre-onboarding edge case) → fall back to the existing 5-minute counter check, unchanged, `reason: 'usage-limit'`.

`GateStatus` type gains `reason: 'ok' | 'usage-limit' | 'trial-expired'`. The 3 call sites in `commands.ts` (~146, ~331, ~626) branch their toast description on `gateStatus.reason === 'trial-expired'` vs the existing minutes-based copy; everything else (dialog open, window focus, error shape) stays identical.

### 11. Verification

- `bun run check` per change; current baseline **70 errors** (re-confirmed this session). New errors = ours; baseline errors not ours.
- Functional: fresh anonymous run → Sidebar shows "Pro trial · 7 days left" with zero sidebar edits; Groq transcription + inline edit work during trial; after 7 days → ChoiceScreen dialog in main shell with the confirmed copy; real trial-expired user still sees only PostTrialDialog; real Pro unaffected.

## Files touched (full list)

| File | Change |
|---|---|
| Supabase SQL (dashboard) | new `anonymous_trials` + `get_anonymous_trial`, drop credit fn+column |
| `src-tauri/src/device_id.rs` | new: `get_device_uuid` via `ioreg`/`IOPlatformUUID` (no new Cargo deps, no permission prompt) |
| `src-tauri/src/lib.rs` | `mod device_id` + register `get_device_uuid` in macOS invoke handler |
| `src/lib/services/device-id.ts` | new: `getDeviceUuid` (Tauri invoke, localStorage fallback off-desktop) |
| `src/lib/stores/subscription.svelte.ts` | anonymous trial branch (getters reused, dodo/cache skipped) |
| `src/lib/services/onboarding-demo-access.ts` | DELETE |
| `src/lib/query/transcription.ts` | revert to plain `subscription.hasProAccess` |
| `src/lib/query/delivery.ts` | revert to plain `subscription.hasProAccess` |
| `src/lib/components/onboarding/ChoiceScreen.svelte` | eyebrow/headline/forceSignupOnFree props |
| `src/lib/components/subscription/AnonymousTrialEndedDialog.svelte` | new |
| `src/lib/settings/settings.ts` | new notice-shown key |
| `src/routes/+layout.svelte` | render dialog; guard PostTrialDialog `!auth.isAnonymous` |
| `src/lib/services/anonymous-gate.ts` | rewritten: time-based `trial-expired` reason replaces usage-only check |
| `src/lib/query/commands.ts` | `signupRequiredMessage()` helper branches copy on `gateStatus.reason` (3 call sites) |
| `src/lib/components/onboarding/OnboardingFlow.svelte` | removed `choice` step: type union, `PROGRESS_STEPS`, `nextStep()`, render branch |
| `src/lib/stores/onboarding.svelte.ts` | removed `'choice'` from `OnboardingStep` |
| `src/lib/settings/settings.ts` | removed `'choice'` from `onboarding.resumeStep` enum (in addition to the new notice-shown key above) |
| `src/lib/components/onboarding/InlineEditDemoScreen.svelte` | no pre-selection (selection is part of the demo), 10s delayed Skip fallback |

## Devlog

### Milestone: Research (done)
- **Corrected a wrong claim:** `use_onboarding_demo_credit` **exists live** (earlier draft said 404). Re-verified two ways: PostgREST OpenAPI shows route with `(p_user_id uuid required, p_limit integer)`, and a direct RPC call returned a 23503 FK violation (function exists and runs). Both it and the `users.onboarding_demo_credits_used` column will be dropped.
- Confirmed no existing Keychain/security-framework code in `src-tauri`. Bundle id `com.priyeshpandey.noteflux`.
- Confirmed `subscription.svelte.ts:65` anonymous bail, PostTrialDialog effect (`+layout.svelte:43-54`), Sidebar badge branch (:179), ChoiceScreen handlers (`handleStartTrial` → `auth.signUp()`, `handleUseFree` → `goto('/settings/transcription')`), both `hasEffectiveProAccess` call sites, the 5-min anonymous gate (`anonymous-gate.ts`).
- `bun run check` baseline: **70 errors**.

### Milestone: Implementation (done)
- Rust: `security_framework::passwords::{get_generic_password, set_generic_password}` (v2 API, verified against docs.rs — the "latest" docs describe a different v3-era `PasswordOptions`/`generic_password()` API that does not match `security-framework = "2"` pinned in Cargo.toml; used the correct v2 signatures). `cargo check` compiles clean, only pre-existing warnings.
- `subscription.svelte.ts`: `refresh()` restructured — signed-out bail unchanged, new `user.isAnonymous` branch calls `getDeviceUuid()` (Tauri, falls back to localStorage off-desktop) then `supabase.rpc('get_anonymous_trial', ...)`, feeds `trialEndsAt` into the same `FREE_SUBSCRIPTION` shape. `isPro` stays false so existing getters (`isTrialActive`, `hasProAccess`, `trialDaysLeft`) and the Sidebar badge work with zero changes there.

### Milestone: Two corrections after user testing (done)
- **Keychain → IOPlatformUUID**: user hit the real macOS Keychain permission prompt on first launch and correctly called it too risky for a cold first-run with zero established trust. Swapped `keychain.rs` for `device_id.rs` (`ioreg -rd1 -c IOPlatformExpertDevice`, parses `IOPlatformUUID`) — no entitlement, no prompt, same reinstall-survives / OS-reinstall-doesn't-survive properties. Dropped the now-unused `security-framework`/`uuid` Cargo deps. Renamed the Tauri command and TS wrapper (`get_or_create_device_uuid` → `get_device_uuid` / `getDeviceUuid`) since nothing is "created" anymore, just read.
- **Removed the end-of-onboarding `choice` step**: user asked why a signup screen appeared right after the inline-edit demo when anonymous sessions already silently have a full 7-day trial running. Correct catch — that screen predates this rework and is now pure friction with misleading copy ("start trial" when one's already active). Removed from `OnboardingFlow.svelte` (type union, `PROGRESS_STEPS`, `nextStep()`, render branch) and `onboarding.svelte.ts`/`settings.ts` (`'choice'` removed from their enums). `ChoiceScreen.svelte` itself is untouched and still used by `AnonymousTrialEndedDialog` — only removed from the onboarding sequence. Sidebar's existing trial badge covers the ambient CTA for the rest of the 7 days.
- `bun run check`: still 70 errors after both changes (one hit lands on the pre-existing `onboarding_completed` log-event union error already documented above — not new). `cargo check`: clean.
- `anonymous-gate.ts` rewritten (not just widened, per the corrected #8 above): checks `trialEndsAt` first — expired → `needsSignup: true, reason: 'trial-expired'` (blocks local + cloud, same call sites that already blocked both); active trial → no cap; no trial on record yet → old 5-minute fallback, unchanged.
- `ChoiceScreen.svelte`: `forceSignupOnFree` prop added; `handleUseFree()` branches to `auth.signUp()` when true. Both `hasEffectiveProAccess` call sites (`transcription.ts`, `delivery.ts`) reverted to plain `subscription.hasProAccess` — the onboarding demo now works for free, since the anonymous session gets a real trial (and thus `hasProAccess`) within moments of `signInAnonymously()` at onboarding start, no separate demo-credit system needed.
- `onboarding-demo-access.ts` deleted; no remaining references (grepped).
- `bun run check`: still **70 errors**, none in any file touched this session (grepped the touched-file list against the error output directly).
- **Not yet done, requires the user to run manually**: the Supabase SQL migration (section 1 above) against the live dashboard — intentionally not run automatically, same as the credit-system migration before it.
- **Not yet done**: manual on-device test of the full flow (anonymous trial grant, Sidebar badge, cloud+local during trial, `AnonymousTrialEndedDialog` at expiry, reactive gate block on both local and cloud after expiry) — needs a real build with Keychain entitlements, can't be verified from `cargo check` alone.

<!-- devlog entries appended after each milestone -->

### Milestone: Doc reconciliation after verification (done)
- Re-verified the full implementation against the plan section by section (git diff + file reads listed nothing missing; the only diff from intention is the deliberately-touched `InlineEditDemoScreen.svelte`, which was already in the working tree).
- `bun run check`: still **70 errors**, `cargo check`: clean. Only touched-file error is the pre-existing `onboarding_completed` union error (present in HEAD at `OnboardingFlow.svelte:140`, now :133 after the `choice` step removal — exactly the one already documented above, not new).
- Replaced the stale `Files touched` table rows (`keychain.rs` / `security-framework`/`uuid` deps / `get_or_create_device_uuid` wording) with the real shipped files (`device_id.rs`, `get_device_uuid`, no new Cargo deps) and added the previously-omitted `InlineEditDemoScreen.svelte` row.
- Rewrote the Review section's Keychain-era "Outstanding" bullets — the Keychain-prompt expectation is now explicitly countermanded (`get_device_uuid` uses `ioreg`/`IOPlatformUUID`, no TCC prompt).

## Review

Replaced the onboarding demo-credit system with a real, device-bound 7-day anonymous Pro trial, and capped anonymous access at exactly those 7 days total — buying Pro and staying on Free both require a real account once the trial ends, closing the "anonymous free users are unreachable forever" gap.

Frontend (`subscription.svelte.ts`) now fetches this trial through the exact same `isTrialActive`/`hasProAccess`/`trialDaysLeft` getters a real signup trial uses, so every existing feature gate, the Sidebar badge, and the onboarding demo screens work unmodified. Abuse control is the Mac's `IOPlatformUUID` (`get_device_uuid`, new Rust command via `ioreg` — no permission prompt, survives reinstalls), not the anonymous Supabase user_id, so reinstalling doesn't reset the clock.

Enforcement past expiry reuses the existing anonymous-gate infrastructure rather than adding a new one: `anonymous-gate.ts` now checks trial expiry by time (not usage), which is what makes it able to block local transcription too — the old 5-minute counter only ever measured cloud minutes, so it structurally could not have enforced this. The same three `commands.ts` call sites that already blocked all recording once tripped needed no new blocking logic, only a copy change (`signupRequiredMessage()` helper) for the new reason.

Deleted the demo-credit system entirely: `onboarding-demo-access.ts`, both its call sites, and (pending manual run) the `onboarding_demo_credits_used` column and `use_onboarding_demo_credit` function in Supabase.

Removed the end-of-onboarding `choice` step — anonymous sessions already have the full 7-day trial from onboarding start, so that screen was now friction with misleading copy. The Sidebar's existing trial badge carries the ambient CTA; the real, forced choice happens only at expiry via `AnonymousTrialEndedDialog` (which reuses `ChoiceScreen` with `forceSignupOnFree`).

Outstanding, requires the user:
- Run the SQL migration (section 1) in the Supabase dashboard.
- Rebuild on-device and manually walk the full flow — fresh anonymous trial, Sidebar badge, cloud+local access during the window, `AnonymousTrialEndedDialog` at expiry, and confirm the reactive gate blocks a post-expiry recording attempt (local and cloud) with the new copy.
- `get_device_uuid` reads `IOPlatformUUID` via `ioreg` — no Keychain/TCC prompt expected on a signed or ad-hoc build (verified on test after the Keychain version prompted immediately and was rejected).

---

## Milestone: Full reversal — signup moves to the last onboarding step (2026-09-25, done)

Everything above this point (device-bound 7-day anonymous trial, `IOPlatformUUID`
device ID, `anonymous_trials` table, `AnonymousTrialEndedDialog`) is **reverted**. Two
things drove this, in order:

1. **Competitive research**: Wispr Flow, Willow Voice, and Aqua Voice all require
   account creation before the first real dictation — none offer anonymous-first
   access. Verified directly (not taking the research's own framing at face value):
   Wispr Flow's docs explicitly confirm a browser-redirect signup (`docs.wisprflow.ai`
   — "Sign in via browser... complete sign-in on the Wispr Flow website that opens"),
   same pattern this app already uses, so the one real unknown (does copying this
   pattern mean a worse app→browser→app round trip than competitors?) turned out not
   to apply — they do the same round trip.
2. **The "goal-gradient effect" idea**: instead of signup-at-start (matching
   competitors exactly) or the anonymous-first-defer-to-day-7 design above, signup was
   moved to the **last** onboarding step instead — after the same real demo already
   built (usage-guide + inline-edit), positioned as "the thing you finish" rather than
   "an ask out of nowhere." Preserves the original "prove it before asking" principle
   this whole redesign was built around, while still getting a real, reachable account
   from everyone who completes onboarding.

### Why this is simpler than both earlier options, not just different
Once signup is *required* to exit onboarding (no anonymous/free escape at the final
step), no anonymous session ever persists past onboarding. That removes the reason
for nearly everything built in the milestones above:
- No persisted trial for anonymous sessions → no `anonymous_trials` table, no
  `get_anonymous_trial` RPC, no device-UUID binding (Keychain or `IOPlatformUUID`) —
  none of it has anything left to protect.
- No lingering anonymous state after onboarding → no `AnonymousTrialEndedDialog`, no
  `!auth.isAnonymous` guard needed on `PostTrialDialog`.
- Cloud/Pro access during the demo no longer needs a trial *or* a credit system —
  just a plain client-side check, `isOnboardingDemoStep()`: `onboardingStore.isOpen &&
  currentStep is 'usage-guide' or 'inline-edit'`. No RPC, no counter, no cap — retrying
  a failed attempt is free, since nothing is being counted. Bounded naturally by the
  onboarding step machine itself (exactly 2 actions, then the forced signup wall), not
  by tracking calls.
- This also makes `anonymous-gate.ts` (the original 5-minute cloud-usage gate)
  redundant, not just simplified: cloud access already requires `hasProAccess` (real
  trial/Pro only) everywhere except the 2-action demo window, so there's no "unlimited
  free cloud while anonymous" hole left for it to guard against. Deleted outright.
- The embedded Groq key (`VITE_EMBEDDED_GROQ_API_KEY`) means none of these client-side
  checks were ever a real security boundary anyway — a motivated attacker can already
  extract the key and call Groq directly, bypassing every gate regardless of which
  design is live. Device-fingerprinting or credit-counting didn't reduce that exposure
  meaningfully; they only added engineering surface. Proportionate response: the
  simplest check that serves honest users well.

### What changed in code
- Re-added the `choice` step to `OnboardingFlow.svelte` (type union, `PROGRESS_STEPS`,
  `nextStep()`, render branch), `onboarding.svelte.ts`, and `settings.ts`'s
  `resumeStep` enum — undoing the earlier removal.
- `ChoiceScreen.svelte`: `forceSignupOnFree` prop removed entirely — it's now always
  true at the only call site, so `handleUseFree()` unconditionally calls
  `auth.signUp()`. The old anonymous "stay free" path (`goto('/settings/transcription')`)
  is gone.
- Deleted: `device_id.rs`, `device-id.ts`, `anonymous-gate.ts` (+ its 3 call sites and
  `refreshAnonymousGateCache()` calls in `commands.ts`), `AnonymousTrialEndedDialog.svelte`.
- `subscription.svelte.ts`: anonymous branch reverted to the original one-line bail —
  anonymous is genuinely free, `isKnown`/`isConfirmed` true immediately, no RPC.
- `+layout.svelte`: `PostTrialDialog` guard and `AnonymousTrialEndedDialog` render
  removed; back to the original real-trial-only effect.
- New `services/onboarding-demo-step.ts`: `isOnboardingDemoStep()`, the plain check
  described above. Wired into `transcription.ts`'s Groq branch and `delivery.ts`'s
  inline-edit branch as `subscription.hasProAccess || isOnboardingDemoStep()`.
- `InlineEditDemoScreen.svelte` (from the same session, kept): pre-selection removed
  (user selects text themselves), Skip delayed 10s instead of shown immediately, and
  `SAMPLE_TEXT` changed from one clause to three joined action items — the "turn it
  into bullets" no-op bug was the model correctly judging a single clause had nothing
  to restructure, not a pipeline failure; multi-clause sample text fixes the root
  cause rather than papering over it with a fallback.
- `bun run check`: still **70 errors** — the only touched-file hit is the same
  pre-existing `onboarding_completed` union error, now at `OnboardingFlow.svelte:140`.
  `cargo check`: clean, no errors.

### Still needed (Supabase cleanup — run manually, not executed automatically)
The `anonymous_trials` table and `get_anonymous_trial` function from the earlier
milestone are now dead. Drop them:

```sql
drop function if exists public.get_anonymous_trial(text);
drop table if exists public.anonymous_trials;
```

The `onboarding_demo_credits_used` column / `use_onboarding_demo_credit` function from
the *original* credit-system milestone were already dropped earlier and stay dropped —
unaffected by this reversal.

### Outstanding
- Run the cleanup SQL above. **Done — verified live 2026-09-25**: `get_anonymous_trial`
  → 404, `anonymous_trials` table → `42P01 does not exist`.
- Manual on-device test, not yet done — everything below is what to walk through:
  - Fresh anonymous run: welcome → permissions → usage-guide (dictation works,
    retry as many times as needed, no cap) → inline-edit (voice-edit works, same —
    try "make it shorter"/"more formal"/"turn it into bullets" on the new
    multi-clause sample text, confirm none of them no-op) → `choice` step shows the
    single "Create free account" CTA (no second button).
  - Clicking it opens the website signup page in the system browser; completing
    signup there should return to the app already Pro-trialing (Sidebar badge).
  - Edge case, not a gap to fix, just confirm it behaves as expected: if the browser
    signup is abandoned (tab closed without finishing), onboarding still marks
    itself complete and closes (pre-existing behavior, `onNext()` fires
    immediately after `auth.signUp()`, doesn't wait for completion) — the user is
    back in the app, still anonymous, local-only. Not a dead end: `AuthSection.svelte`
    (Sidebar) already shows a persistent "Get Pro" CTA for anonymous users outside
    onboarding too, so they can retry signup any time, not just during onboarding.
  - Dialog should stay non-dismissable through `choice` (`onEscapeKeydown`/
    `onInteractOutside` both guard on `currentStep !== 'welcome'`, unchanged).

---

## Milestone: ChoiceScreen collapsed to one CTA (2026-09-25, done)

**The catch**: after the reversal above, `ChoiceScreen` still showed two buttons —
"Start 7-day free trial" (Pro card) and "Stay on Free" — as if they led to different
outcomes. They don't. Both called the identical `auth.signUp()`, and every real signup
gets the identical `trial_ends_at = now() + 7 days` DB default regardless of intent
(verified fact, not new — traced through `fetchSubscriptionStatus` in
`services/subscription/dodo.ts`, confirmed untouched all session, hitting
`noteflux.app/api/subscription`, backed by the same DB default established earlier).
A user who deliberately picked "Stay on Free" to avoid a trial would get one anyway —
that's not a choice, it's the same door with two signs on it.

**Fix**: `ChoiceScreen.svelte` now has exactly one CTA. Removed `handleUseFree()`
entirely, renamed `handleStartTrial` → `handleSignUp` (there's no separable "trial"
action anymore, just "sign up"), removed the "Stay on Free" button and its
`HardDriveIcon` import. The Pro feature list stays — it's true content, genuinely
what they get — but now frames what's *included*, not a competing plan: "Included
free for 7 days" instead of a "Recommended" badge implying an alternative existed.
Added an explicit honesty line under the button: "No card required. Local
transcription stays free forever either way" — so the one real fact that *does*
differ by nothing (local access) is stated plainly instead of implied by a now-removed
second button.

`bun run check`: still 70, no new errors, `ChoiceScreen.svelte` clean.

## Current architecture (what's actually live, read this section if catching up)

1. Anonymous session created via `signInAnonymously()` at onboarding start
   (`OnboardingFlow.svelte` onMount) — unchanged from the app's original behavior,
   exists purely so the two demo actions have something to authenticate with.
2. During onboarding, `usage-guide` (dictation) and `inline-edit` steps get Pro-tier
   access via `isOnboardingDemoStep()` (`services/onboarding-demo-step.ts`) — a plain
   `onboardingStore.isOpen && step check`, no RPC, no counting, unlimited retries.
3. Onboarding's last step (`choice`) shows `ChoiceScreen` with one CTA: create a real
   account. No anonymous exit from onboarding exists — and onboarding only actually
   *completes* once the deep-link callback confirms a real, non-anonymous session
   (verified via a direct `supabase.auth.getUser()` call, not the reactive auth
   store's snapshot). Clicking the button just opens the browser; if that signup is
   abandoned or fails, onboarding stays open and the button can be clicked again
   (2026-09-26 fix — it originally called `onNext()` immediately on click, which
   marked onboarding complete regardless of whether signup ever succeeded, silently
   defeating the "no anonymous exit" guarantee for anyone who closed the browser tab).
4. Every real signup gets `trial_ends_at = now() + 7 days` automatically (DB default,
   pre-existing, unrelated to this feature). `subscription.svelte.ts`'s real-account
   branch (`fetchSubscriptionStatus` → `noteflux.app/api/subscription`) picks this up
   exactly as it always has — nothing in this feature touches that path.
5. Anonymous sessions are always genuinely free (`subscription.svelte.ts`'s one-line
   bail) — no persisted trial, no device tracking, no gate beyond step 2's demo
   exception. If someone abandons onboarding mid-way and reopens the app later,
   onboarding resumes where they left off (existing `resumeStep` mechanism,
   untouched) — there's no anonymous "free forever" state to fall into.