# Replace Polar.sh with DodoPayments for Noteflux Pro Subscriptions

## Goal

Wire up Noteflux Pro subscriptions (monthly + yearly) using **DodoPayments** instead of Polar.sh. Both the Noteflux website (Next.js + Supabase) and the whisper-2 desktop app must share one payment flow, and the desktop app's client-side subscription state must be real (not mock).

## Current State (what I found)

The Polar flow was built but never finished. There are two repos:

- **noteflux--** (website, Next.js + Supabase, currently on `main`): has `lib/services/polar.ts`, `app/checkout/page.tsx`, and API routes `app/api/checkout`, `app/api/subscription`, `app/api/webhooks/polar`. Uses one hardcoded `POLAR_PRODUCT_ID`. It works end to end but only for a single product, and it's Polar.
- **whisper-2** (desktop Tauri + Svelte 5, currently on `feat/inline-transcription`): the subscription code ONLY exists on the `payment` branch (`src/lib/services/subscription/polar.ts`, Subscribe buttons in `AuthSection.svelte` and `Sidebar.svelte`). The current branch does NOT have it wired at all.

### The old (Polar) end-to-end flow

```
Desktop "Subscribe" button
  -> opens noteflux.app/checkout?user_id=xxx in browser (Tauri opener)
    -> checkout page checks Supabase auth
      -> "Subscribe to Pro" -> POST /api/checkout
        -> server calls Polar to create checkout session
          -> user redirected to Polar hosted checkout
            -> payment completes
              -> Polar webhook -> POST /api/webhooks/polar
                -> updates Supabase users (subscription_tier, subscription_id, subscription_period_end)
                  -> desktop polls GET /api/subscription?user_id=xxx to see Pro
```

**Not wired yet**: the desktop's `checkSubscription()` returns hardcoded `free`. Everything else (backend) was scaffolded.

**Two products (monthly + yearly)**: created on the payments dashboard already, but the current code only had room for one `POLAR_PRODUCT_ID`.

## DodoPayments Facts (from the DodoPayments knowledge MCP)

- **Checkout**: `POST /checkouts` with:
  - `product_cart[{ product_id, quantity }]` (required)
  - `customer: { email }`
  - `return_url` (where user is redirected after payment)
  - `cancel_url`
  - `metadata` (arbitrary key/value; use to store `user_id`)
  - Returns `checkout_url`, `session_id`.
- **Base URLs**: test `https://test.dodopayments.com/`, live `https://live.dodopayments.com/`.
- **Auth**: `Authorization: Bearer <YOUR_API_KEY>`.
- **After payment** the user is redirected to `return_url` with `subscription_id`, `status`, `email` appended as query params. IMPORTANT: this redirect is a UI hint, not proof. Always confirm via webhook.
- **Webhooks**: follow the Standard Webhooks spec. Headers: `webhook-id`, `webhook-signature`, `webhook-timestamp`. Signature = HMAC-SHA256 over `webhook-id.webhook-timestamp.<raw_body>` using the webhook secret. Two ways to verify:
  1. Use the official `dodopayments` npm SDK: `client.webhooks.unwrap(body, { headers: {...} })` (recommended).
  2. Manual Standard Webhooks verification against `DODO_PAYMENTS_WEBHOOK_KEY`.
- **Webhook events** (note spelling: `cancelled`, `unpaused`):
  - `subscription.active` (activated, recurring scheduled)
  - `subscription.updated` (any field change, real-time sync, no polling needed)
  - `subscription.past_due` (renewal failed, grace period, access kept)
  - `subscription.on_hold` (failed renewal, access revoked)
  - `subscription.paused` / `subscription.unpaused`
  - `subscription.renewed`
  - `subscription.plan_changed`
  - `subscription.cancelled`
  - `subscription.failed` (creation failed)
  - `subscription.expired` (term ended)
- **Status enum** on a subscription: `pending`, `active`, `past_due`, `on_hold`, `paused`, `cancelled`, `failed`, `expired`.

## Update (2026-09-11)

Decisions made after the products already existed live in Dodo (`pdt_0Nn9XxO4DbXcune4RrieB` = Pro Monthly $7/mo, `pdt_0Nn9XxQqTFXLKsoAwahMr` = Pro Yearly $72/yr — see Dodo dashboard, test-mode equivalents should be created too before wiring anything):

- **Both entry points get a Monthly/Yearly picker, not just the website.** Resolves Open Item #1 below. The website keeps its own `/checkout` page with a toggle (for anyone arriving from the marketing site directly, not via the desktop app). The desktop app gets its **own** inline Monthly/Yearly picker too — this is the lower-friction path for anyone already in the app: pick a plan with one tap, no second "click Subscribe again" screen in the browser.
- **Desktop calls `/api/checkout` directly, skips rendering the website's checkout page.** Instead of opening `noteflux.app/checkout?user_id=xxx` in the browser and making the user click "Subscribe to Pro" a second time there, the desktop app POSTs to `/api/checkout` itself (passing the app's existing Supabase access token as an `Authorization` header, since the user is already logged into the desktop app — no need for the website's cookie-based session check), gets `checkout_url` back, and opens the browser directly on Dodo's hosted payment page. One tap in-app -> pay -> deep-link back. This means `app/api/checkout/route.ts` needs to accept either a browser session (from the website's own checkout page) OR a bearer token (from the desktop app) — both paths converge on the same Dodo checkout-session creation logic.
- **Reference implementation exists on the `payment` branch** (local and `origin/payment`) in this repo — has `src/lib/services/subscription/polar.ts`, and Subscribe buttons wired into `AuthSection.svelte` and `Sidebar.svelte`. Port the *shape* of that code (subscription store, button placement) over to `dodo.ts`, updated for the direct-API-call flow above (not the polar.ts open-browser-to-webpage flow).
- **This work happens on `feat/dodo-payments-subscription`** (branched off `feat/inline-transcription`'s tip on 2026-09-11). Unrelated in-flight work from that branch (answer-overlay multi-turn Q&A, recorder warm-stream fix, onboarding dictation fix, tray-menu cleanup) was stashed rather than committed here — it's unrelated to payments and shouldn't be mixed into this branch's history. Find it with `git stash list` (`wip: answer-overlay multi-turn, recorder warm-stream, onboarding dictation fix, tray cleanup`), restore on `feat/inline-transcription` with `git stash pop` when needed.

## Design Decisions

1. **Two products => two product IDs.** Store `DODO_PRODUCT_ID_MONTHLY` and `DODO_PRODUCT_ID_YEARLY` as env vars. Both the website checkout page AND the desktop app show a Monthly / Yearly toggle (see "Update" above); whichever picks first, the chosen product ID is passed to the checkout session. Keep this minimal: no new DB table, just env vars.

2. **`metadata.user_id` is the join key.** Every checkout gets `metadata: { user_id }`. The webhook reads `data.metadata.user_id` to know which Supabase user to update. This is identical to the Polar design, so the mapping stays.

3. **Map Dodo subscription state to our `free`/`pro` tier.** We only have `free` and `pro` in Supabase. Derive `isActive` from the Dodo status:
   - Active/paying (still has access): `active`, `past_due` (grace period) => pro
   - No access: `cancelled`, `expired`, `failed`, `on_hold`, `paused` => free

4. **Keep the same DB schema.** No schema migration beyond what Polar already planned: `users.subscription_tier`, `users.subscription_id`, `users.subscription_period_end`. Optionally add `plans` handling via metadata or one table if we want billing history; keep it out of scope for now.

5. **Desktop polls `/api/subscription`** (same as the Polar plan intended). The desktop app does not talk to Dodo directly; all Dodo API calls live on the Noteflux website (keeps the API key server-only). The desktop only calls the website's `/api/checkout` and `/api/subscription` endpoints.

6. **Rename polar.ts -> dodo.ts** so nothing is left referencing Polar.

## Deep Link on Success

Polar's plan had the desktop `openCheckout()` open `noteflux.app/checkout` in the browser via Tauri opener, then (on the website success page) an "Open Noteflux App" button using the `noteflux://` custom URL scheme. Keep this exact flow: it already exists in the Noteflux checkout success block and works with the Tauri opener. The Dodo `return_url` should point at `/checkout?success=true` so the existing success UI and `noteflux://` deep link are reused unchanged.

## TODO Checklist

### Website (noteflux-- repo)

- [x] **Add DodoPayments SDK**: `npm install dodopayments` (noteflux-- uses npm, not bun — avoids a second lockfile). v2.50.0.
- [x] **Create `lib/services/dodo.ts`** replacing `lib/services/polar.ts`:
  - `createCheckoutSession({ userId, userEmail, productId, successUrl, cancelUrl })` -> calls SDK `checkoutSessions.create` with `product_cart`, `customer.email`, `return_url`, `cancel_url`, `metadata.user_id`. Returns `checkout_url`.
  - `getSubscriptionStatus(userId)` -> read Supabase `users` row, derive `{ tier, isActive, subscriptionId, currentPeriodEnd }` (same shape as Polar version).
  - `updateUserSubscription(userId, { tier, subscriptionId, periodEnd })` -> Supabase update, via service-role client when `SUPABASE_SERVICE_ROLE_KEY` is set (webhooks have no user session; bypasses RLS), falling back to the cookie client.
  - `handleDodoWebhook(body, headers)` -> `client.webhooks.unwrap(...)` then map events to `updateUserSubscription` via status-based tier mapping.
- [x] **Update `app/api/checkout/route.ts`**:
  - Accept `{ plan: 'monthly' | 'yearly' }` from the client body; default to monthly.
  - Build product selection; pass the right `DODO_PRODUCT_ID_MONTHLY` / `DODO_PRODUCT_ID_YEARLY`.
  - POST the checkout to Dodo, return `checkoutUrl`.
  - Accept a **Supabase Bearer access token (desktop)** OR the cookie session (website checkout page); body `userId` override removed (security).
  - CORS headers + `OPTIONS` handler so the Tauri webview fetch is allowed.
- [x] **Delete `app/api/webhooks/polar/route.ts`**, add `app/api/webhooks/dodo/route.ts`:
  - Read raw body; verify signature via SDK `unwrap`.
  - Handle all `subscription.*` events via status mapping; update Supabase via `updateUserSubscription`.
  - 401 on invalid signature, 400 on missing `user_id` / failed update, 200 otherwise.
- [x] **Update `app/checkout/page.tsx`**:
  - New client component `components/checkout/plan-selector.tsx` (Monthly $7 / Yearly $72, 2 months free); server-action form removed.
  - `{ plan }` posted to `/api/checkout`, redirects to `checkoutUrl`.
  - Success/cancel UI and the `noteflux://` "Open Noteflux App" button kept.
- [x] **Update `app/api/subscription/route.ts`** import from `polar.ts` to `dodo.ts`, plus bearer → cookie → `user_id` resolution and CORS.
- [x] **Env vars / `.env`**: `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_ENVIRONMENT` (`live_mode` — user chose to run live with real products + a 100%-off discount code for testing), `DODO_PAYMENTS_WEBHOOK_KEY`, `DODO_PRODUCT_ID_MONTHLY`, `DODO_PRODUCT_ID_YEARLY`, `SUPABASE_SERVICE_ROLE_KEY`. `POLAR_*` removed. **Still to do**: mirror these in Vercel for `noteflux.app`.
- [ ] **Dodo dashboard (user action)**: set the webhook URL to `https://noteflux.app/api/webhooks/dodo`, subscribe to the subscription events above, copy the signing secret into `DODO_PAYMENTS_WEBHOOK_KEY` (prod + local).

### Desktop (whisper-2 repo)

- [x] **Add `src/lib/services/subscription/dodo.ts`**:
  - `fetchSubscriptionStatus(userId, accessToken)` -> `GET https://noteflux.app/api/subscription?user_id=...` with Bearer token, read `{ tier, isActive, subscriptionId, currentPeriodEnd }` (REAL call, replaces the mock).
  - `createCheckoutSession(accessToken, plan)` -> `POST https://noteflux.app/api/checkout` with `{ plan }` + Bearer token; returns `checkoutUrl`.
  - `openCheckoutUrl(checkoutUrl)` -> Tauri `openUrl` (with always-on-top disable), fallback `window.open`, straight to Dodo's hosted checkout (website `/checkout` page bypassed on this path).
- [x] **Add `src/lib/stores/subscription.svelte.ts`** — reactive ($state) store mirroring the auth store pattern; exposes `tier`, `isPro`, `currentPeriodEnd`, `checkSubscription()`, `openCheckout(plan)`. Refreshes on auth state change and window focus (returning from checkout). This replaces the reference `polar.ts`'s non-reactive mock store.
- [x] **Wire Subscribe buttons + Monthly/Yearly picker (two one-tap buttons)** into `AuthSection.svelte` (Subscribe Monthly / Subscribe Yearly + Pro badge) and `Sidebar.svelte` (Pro Monthly / Pro Yearly footer items with ZapIcon). Shown only when authenticated, not anonymous, and not already Pro.

### Website (noteflux-- repo) — additional item for the direct desktop flow

- [x] **`app/api/checkout/route.ts` accepts a bearer token, not just a browser session.** `Authorization: Bearer <supabase_access_token>` is checked first (desktop path); falls back to the cookie-based session check (website `/checkout` page path). Both resolve to the same `userId` before building the Dodo checkout session.

## Questions / Open Items

1. ~~Do we want the Monthly / Yearly toggle to live only on the website checkout page, or should the desktop app also let the user pick?~~ **Resolved 2026-09-11**: both. See "Update" section above.
2. ~~Do we want a true billing history table, or is updating `users` enough for now?~~ **Resolved 2026-09-11**: updating `users` only (`subscription_tier`, `subscription_id`, `subscription_period_end`); no billing history table.
3. ~~Confirm the two real product IDs and whether the desktop deep link `noteflux://` scheme is already registered in the desktop app's Tauri config.~~ **Resolved 2026-09-11**: product IDs confirmed live via the Dodo MCP (`pdt_0Nn9XxO4DbXcune4RrieB` Pro Monthly $7, `pdt_0Nn9XxQqTFXLKsoAwahMr` Pro Yearly $72). User created the products in live mode (test-mode equivalents skipped by choice). `noteflux://` deep link **is registered**: `apps/whispering/src-tauri/tauri.conf.json` → `plugins.deep-link.desktop.schemes: ["noteflux"]`, `tauri-plugin-deep-link = "2"` in Cargo.toml, `.plugin(tauri_plugin_deep_link::init())` in `lib.rs`, and an `onOpenUrl` handler in `auth-service.ts`. Note: `capabilities/default.json` lacks an explicit deep-link permission (pre-existing gap; OS-level open still works).

## Review

(Written after implementation, 2026-09-11.)

**Website (`noteflux--`, branch `feat/dodo-payments-subscription`, based on `main`):** DodoPayments replaces Polar end to end. `lib/services/dodo.ts` wraps the SDK (lazy client init so a missing key yields a graceful "not configured" error instead of throwing at import); `utils/supabase/admin.ts` adds a service-role client used only by the webhook updater so the `users` write works under RLS. `/api/checkout` accepts `{ plan: 'monthly' | 'yearly' }` and authenticates via Bearer token (desktop) or cookie (website), with CORS + `OPTIONS` for the Tauri webview, and no longer trusts a client-supplied `userId`. `/api/subscription` resolves bearer → cookie → `user_id`. `/api/webhooks/dodo` verifies via SDK `unwrap` and maps status → tier (`active`/`past_due` → pro; everything else → free). Checkout page uses a new `PlanSelector` client component. Polar service, webhook route, and all env vars removed. `npm run build` passes.

**Desktop (`whisper-2`, branch `feat/dodo-payments-subscription`, based on `main` — `feat/inline-transcription` is already merged):** `services/subscription/dodo.ts` (status fetch + checkout creation + opener) and a reactive `stores/subscription.svelte.ts` mirroring the auth store, refreshing on auth change and window focus (covers returning from checkout; a focus listener replaces a polling interval). `AuthSection` and `Sidebar` get one-tap Monthly / Yearly subscribe buttons shown only for authenticated, non-anonymous, non-Pro users; Pro users see a badge. `bun run check`: no errors in changed files (71 pre-existing errors elsewhere on this branch were left untouched).

**Deviations from the plan, recorded honestly:** (1) `npm install` instead of `bun add` in noteflux-- (npm is that repo's package manager). (2) Live mode instead of test mode — user created real products before this work and provided a 100%-off discount code to test the real flow at $0. (3) The reference `polar.ts`'s non-reactive/mock store was replaced by a proper reactive `$state` store wired to the real API. (4) Added `SUPABASE_SERVICE_ROLE_KEY` (new env var) so the webhook can write under RLS; without it the webhook silently fails on a strict RLS setup. (5) Dodo MCP is registered in opencode global config (`remote` type, OAuth auto-detection) for future sessions.

**Still required for the E2E test:** deploy the website, set the DODO/Supabase env vars in Vercel, create the Dodo webhook endpoint (`https://noteflux.app/api/webhooks/dodo`, all `subscription.*` events) and copy its secret, then test the desktop subscribe flow with the 100%-off code (real checkout, $0 charge, webhook flips `users.subscription_tier` to `pro`).

## Known Gap Discovered Later (2026-09-12, not fixed yet)

This spec wired up `subscription.isPro` (status fetch, store, checkout,
paywall UI) but never audited **which actual features check it**. Found one
real, undocumented gap while auditing the payment flow end to end:

`total_usage_limit`-based lifetime cap never checks `subscription.isPro`.
- `src/lib/services/usage-tracking.ts` (`checkUsageLimitAndBlockStatus()`,
  ~lines 267-337) reads `total_minutes`/`limit_minutes` (default **2000
  minutes lifetime**)/`is_blocked` from `total_usage_limit`. No reference to
  `subscription` anywhere in the file.
- `src/lib/query/transcription.ts` (`transcribeBlob`, ~lines 151-268) calls
  this check for every authenticated user and blocks transcription with a
  "⚠️ Usage limit reached" dialog once `isOverLimit`/`is_blocked` — Pro or
  free, no distinction.

Result: a paying Pro subscriber who crosses 2000 lifetime transcription
minutes gets blocked exactly like a free user, despite the product's own
pricing copy advertising "Unlimited voice recordings" as the Pro feature.
The anonymous 5-minute gate (`anonymous-gate.ts`) is unaffected and already
correctly skips non-anonymous accounts — this is a separate check.

**Not fixed yet** — touches the live transcription path, bigger blast
radius than the payment-UI fixes done alongside this audit, so it's holding
for explicit confirmation before changing. Fix shape: bypass
`checkUsageLimitAndBlockStatus()`'s block when `subscription.isPro` is true,
at both call sites in `transcription.ts`. Also logged in `noteflux--`'s
`polish-payment-flow.md`.

## Reference: DodoPayments key differences from Polar

| Concern | Polar (old) | DodoPayments (new) |
|---|---|---|
| Checkout endpoint | `POST /checkouts` (polar) with `product_id` | `POST /checkouts` with `product_cart[{product_id,quantity}]` |
| Webhook signature | HMAC SHA-256 manual | Standard Webhooks (SDK `unwrap` or manual) |
| Webhook headers | `polar-signature` | `webhook-id`, `webhook-signature`, `webhook-timestamp` |
| Cancel spelling in events | `canceled` | `cancelled` |
| Pause/resume events | `paused`, `resumed` | `paused`, `unpaused` |
| Two products | not supported (single `POLAR_PRODUCT_ID`) | two env vars or product_cart selection |
