# Onboarding redesign — real Pro demo before the signup choice

Supersedes the earlier `trial-offer` onboarding step (built, then reasoned
out of, over the course of this conversation — see
`20260921T055638-action-mode-toggle-v1.md`'s neighbor docs for that history).
That version showed a static illustration and asked for signup with no
proof. This version lets the user actually experience Pro before choosing.

## Why this shape, not the earlier one
- Local free tier isn't demoable during onboarding at all — the local model
  (Qwen3-ASR) isn't downloaded yet at that point, so "try it locally" is not
  technically possible before permissions + a real choice screen.
- Hands-on beats a static illustration — confirmed by direct pushback during
  design. A real dictation result and a real inline-edit result, done by the
  user's own hand, sell Pro far better than a mockup ever could.
- The choice between Pro and Free should come *after* they've felt both
  demos, not before — grounds the decision in a real result instead of a
  description.

## Flow

1. **Welcome** — brief, no choice yet.
2. **Permissions** — mic + accessibility (existing, unchanged). Anonymous
   session already created before this point (existing behavior, unchanged).
3. **First action demo (dictation)** — real, interactive. Runs on cloud
   (Groq) via the new anonymous demo-credit system below, since local isn't
   downloaded yet and no account/trial exists at this point regardless.
4. **Inline-edit demo** (new screen) — real, interactive. Sample text in the
   dialog, select it, speak an edit, watch it actually rewrite. Same credit
   budget as step 3.
5. **Choice screen** — "Sign up — start 7-day Pro trial, no card" vs. "Use
   free version". Replaces the old static trial-offer screen entirely.
6. **6a (chose Pro)**: existing browser signup flow (`auth.signUp()`,
   unchanged) — **trial-grant-on-signup verified real via direct DB query,
   2026-09-23**: a clean account (`d435ad62...`, never purchased) has
   `trial_ends_at` set to exactly `created_at + 7 days`. Confirmed working,
   not assumed.
7. **6b (chose free)**: send straight to **Settings → Transcription**
   (existing page) to pick + download a local model. No new UI here —
   improve what's already there, not a new onboarding-specific model picker.
8. **Complete.**

## The anonymous demo-credit system (backend, website repo)

Why it's needed: without a server-side limit, "let anonymous users try Pro
during onboarding" is indistinguishable from "give away free unlimited Groq
usage to anyone who scripts a call to the endpoint directly" — the embedded
Groq key in the client bundle means there's no gateway between the app and
Groq to rate-limit at; the only enforcement point is the entitlement check
itself (does the server say "yes, act as Pro for this call").

Design, reusing existing infrastructure rather than building new:
- One new column on the existing `users` table (same table already tracking
  `subscription_tier` / `trial_ends_at` — anonymous sign-ins get a real row
  here too): `onboarding_demo_credits_used integer default 0`.
- Budget: **5 credits**, shared across both demo screens (bumped from an
  initial 2 — real UX retry noise, like the first-click bug fixed earlier
  tonight, needs headroom).
- One small server-side check (Supabase function/RPC, not a new table or
  service) atomically checks-and-increments before allowing a demo call.
- **Known, accepted gap**: resets on app reinstall (fresh anonymous
  Supabase user_id each time, confirmed earlier this session). Not treated
  as a real risk at this credit level — reinstalling is real friction for a
  few cents of Groq usage, self-limiting by cost, not worth scripting.
  Mitigation if ever needed: tie credits to a Keychain-stored device UUID
  instead of/alongside the anonymous user_id (same idea discussed for the
  hypothetical anonymous-trial design, never built, reusable here).

## Todo
- [x] Verify signup grants trial automatically (direct DB query — confirmed)
- [ ] Backend: add `onboarding_demo_credits_used` column + check/increment
      function (website repo, Supabase) — frontend calls `use_onboarding_demo_credit`
- [x] Frontend: wire the demo-credit check into the dictation demo call
      (`hasEffectiveProAccess` in `services/onboarding-demo-access.ts`)
- [x] Frontend: new inline-edit demo screen
- [x] Frontend: reorder onboarding steps to match the flow above
- [x] Frontend: new choice screen (replaces old trial-offer screen)
- [x] Frontend: free-path redirect to Settings → Transcription
- [x] Review/improve existing Settings → Transcription copy (cloud services
      are now disabled + labeled "(Pro)" for free users, with a subtitle
      explaining Qwen3-ASR stays free)
- [ ] Manual test: full flow both branches, on a rebuilt app with fresh
      permissions grant (learned tonight: ad-hoc signing drops permissions
      on every rebuild)

## Review
Branch `feat/onboarding-pro-demo-redesign`.

Cleaned up before pushing:

- Removed dead tracked files never referenced anywhere: `OnboardingFlow.svelte.final`,
  `PermissionsScreen.svelte.bak`, `permission-monitor.ts.bak`,
  `create-key-recorder.svelte.ts.bak` (all superseded by live files).
- Removed the now-dead skip path: `skipOnboarding`, the `onSkip` props on
  Welcome/Permissions/UsageGuide screens (no screen renders a skip button in
  the redesign), and `analytics.trackOnboardingSkipped`.
- Removed `TRANSCRIPTION_SERVICE_OPTIONS` export (dead once Settings →
  Transcription built a reactive options list).
- Trimmed per-call debug `console.log`s from `onboarding-demo-access.ts`
  (they would have fired on every free-user transcription); kept error logs.

`bun run check` (`svelte-check`): 70 errors on this branch vs 71 on `main`
across a superset — zero new type errors introduced. The ~70 pre-existing
errors (drawer/modal/copy-button ui, config files, `test-persist-toast`, the
`onboarding_completed` log-event union, etc.) are untouched.

Known pre-existing issue, not caused by this branch: the `lint` script
cannot run — `src/lib/config/eslint.ts` imports `eslint-config-prettier`,
which is not a declared dependency.

Notes for when the backend lands: `hasEffectiveProAccess` calls
`supabase.rpc('use_onboarding_demo_credit', { p_user_id })` and fails closed
on error; the demo steps are `usage-guide` + `inline-edit`. The 2026-09-22
action-mode research doc was intentionally left untracked (unrelated to
this work).
