# Pricing Launch Checklist — Free vs Pro Gating

**Created:** 2026-09-16
**Scope:** spans two repos — `whisper-2` (desktop app, this repo) and `noteflux--` (website, `/Users/priyesh/Desktop/noteflux--`).
**Why this doc exists:** verifying that what the pricing cards *say* Pro gets is actually *enforced* in code, not just copy. Several items below were advertised before they were gated — this tracks closing that gap.

## Done (committed)

- [x] **Website:** `isPro` now checks `tier === "pro" && isActive`, not just tier (`app/pricing/page.tsx`) — commit `7e61380` on `noteflux--`'s `feat/customer-portal-and-duplicate-guard`.
- [x] **Website:** real "Manage subscription" button wired to a new `POST /api/customer-portal` → Dodo hosted billing portal, replacing the dead-end "You're on Pro" link — same commit.
- [x] **Website:** `createCheckoutSession()` now refuses a second checkout if the customer already has an active Dodo subscription — the actual fix for the real duplicate-subscription incident — same commit.
- [x] **Desktop:** local models (Qwen3-ASR, future Parakeet) exempt from the 2000-min usage cap for every tier — `transcription.ts`, `isLocalService`.
- [x] **Desktop:** Pro subscribers exempt from the usage cap on cloud (Groq) transcription too — `transcription.ts`, `isExemptFromUsageLimit = isLocalService || subscription.isPro` (uncommitted as of this doc — see below).
- [x] **Both:** pricing card copy updated and kept in sync — Free: voice-to-text, local models free forever, custom dictionary, community support. Pro: unlimited recordings (local & cloud), custom AI cleanup, select-and-speak inline edit, priority support, early access. Plus an "Everything in Starter, plus:" lead-in on the Pro card (uncommitted on desktop and website — see below).
- [x] Duplicate-subscription incident root-caused as far as reachable: webhook endpoint and env vars were confirmed live before the failing purchase; exact cause of that one silent failure was never found (investigation was interrupted, not concluded).

## Gating accuracy check — this is what you asked about

Cross-checked every bullet actually on the Pro card against what's enforced in code (`grep subscription.isPro` across `whisper-2`):

| Pro card bullet | Actually gated to Pro? |
|---|---|
| Unlimited voice recordings — local & cloud | **Yes** — local exempt for everyone, cloud exempt only for Pro (`isExemptFromUsageLimit`) |
| Custom AI cleanup — ready by default, yours to customize (Transformations) | **No** — makes a real Groq LLM call, but nothing in `transformations.ts`/`delivery.ts` checks `subscription.isPro`. Free users have full access today. |
| Select text, say the change, it's rewritten (Inline Edit) | **No** — same gap. `delivery.ts`'s inline-edit path (Groq `gpt-oss-120b` call) has zero tier check. Free users have full access today. |
| Priority support / Early access | N/A — these are ops/process promises, not code features, nothing to gate |

**So: no, Pro is not fully gated from Starter yet.** The usage-cap row is correct. The two AI-feature rows are advertised as Pro perks but are currently free-for-everyone in code — same shape of bug as the original "unlimited recordings" issue this whole thread started from, just not yet fixed for these two.

## Not done — next action steps, in priority order

1. **Gate Transformations and Inline Edit behind `subscription.isPro`, or stop advertising them as Pro-exclusive.** Pick one — don't leave the copy claiming something the code doesn't enforce. Both hit Groq for real, so gating them is the honest, cost-consistent choice (same reasoning already applied to cloud transcription).
2. **Desktop needs its own "Manage subscription" action.** The website has a real portal button now; `AuthSection.svelte`/`Sidebar.svelte` on desktop still show a static Pro badge with no click-through at all. Needs: Bearer-token POST to `/api/customer-portal`, then open the returned URL via the existing `openCheckoutUrl`-style opener.
3. **Commit and push the uncommitted work in both repos** — desktop's `transcription.ts` (Pro cloud exemption) + `ProPricingDialog.svelte` (copy), website's `pricing-cards.tsx` (copy). None of this is pushed yet.
4. **Open a PR for `noteflux--`'s `feat/customer-portal-and-duplicate-guard`** — pushed to origin, no PR yet.
5. **Resolve the actual duplicate Dodo subscriptions** on the incident test account (`priyeshpandey2000@gmail.com`) — `sub_0NnMH8tx7LfomEMuA3b10` (monthly) and `sub_0NnOC3zzVO5wm9XgE1W5t` (yearly) are both still active in Dodo. Needs a manual decision on which to cancel; the code fix prevents new duplicates, it doesn't clean up the existing one.
6. **Decide on the monthly↔yearly plan-switch flow** — flagged in commit `7e61380`'s own message as not done. Right now a Pro user trying to switch plans gets refused by the new duplicate-subscription guard, with the customer portal as the only way through. Needs a product call: build a dedicated `subscriptions.changePlan()` flow, or accept the portal as sufficient.
7. **(Lower priority, not urgent)** Find the actual root cause of the original webhook failure — investigation was never concluded, just worked around by chance via a second purchase.
