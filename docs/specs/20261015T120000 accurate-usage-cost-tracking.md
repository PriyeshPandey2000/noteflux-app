# Accurate per-user usage cost tracking

Branch: `feat/accurate-usage-cost-tracking` (off latest `origin/main`)

## Goal

Know real cost per user so we can compute profit per Pro subscriber. Today `usage_logs` and `llm_usage_logs` under-report cost. Fix the numbers that are verifiably wrong, using Groq's official docs (console.groq.com/docs/models, /docs/speech-to-text). Do not add guessed numbers.

## Verified pricing (Groq docs, checked 2026-10-15)

| Model | Price |
|---|---|
| `whisper-large-v3-turbo` | $0.04/hr |
| `whisper-large-v3` | $0.111/hr |
| Whisper minimum | 10s billed per request |
| `openai/gpt-oss-120b` | $0.15 in / $0.60 out per 1M tokens |
| `openai/gpt-oss-20b` | $0.075 in / $0.30 out per 1M tokens |
| `qwen/qwen3.8-27b` (Preview) | $0.80 in / $4.00 out per 1M tokens |

Not documented, so not guessed: browser search tool fee, how search tokens are counted, whether Qwen accepts image input.

## What is wrong today

1. `calculateCost` in `services/usage-tracking.ts` hardcodes $0.03/hr for all Groq and ignores the model. Turbo is $0.04, v3 is $0.111.
2. 10s per-request minimum not applied. A 3s dictation is billed as 10s.
3. `commands.ts` logs `model: ASK_MODEL` even when an image forced the Qwen vision model, so image questions get priced at the wrong rate.
4. No Qwen entry in `LLM_COSTS_PER_MILLION_TOKENS`, so image questions log $0 and a warning.
5. `trackUsage` never receives the model, so cost cannot be model-aware.

## Plan

- [x] `services/completion/groq.ts`: export `GROQ_VISION_MODEL` (already defined, currently private).
- [x] `services/usage-tracking.ts`: replace the flat Groq rate with a per-model rate table (turbo, v3) and bill `max(duration, 10s)`. Fix the stale `$0.03/hour` comments.
- [x] `services/usage-tracking.ts`: add `groq:qwen/qwen3.8-27b` ($0.80 / $4.00) to `LLM_COSTS_PER_MILLION_TOKENS`.
- [x] `services/usage-tracking.ts`: `trackUsage` accepts `model` to pick the rate (not stored; avoids a schema change that would break inserts if the client shipped before the column).
- [x] `query/transcription.ts` (~line 460): pass the real Groq `modelId` (from `transcription.groq.model` setting via `GROQ_MODELS`) to `trackUsage`.
- [x] `query/commands.ts` (~line 849): log `askThreadImage ? GROQ_VISION_MODEL : ASK_MODEL`.

Each change is a few lines. No new files besides SQL below.

## SQL (run in Supabase; schema lives outside this repo)

Column names for existing tables are inferred from the insert calls in `usage-tracking.ts`. Check them against the real schema before running.

```sql
-- 1. restate historical transcription cost with real rates
-- old rows have no model; assume turbo (the default). Billed length has a 10s floor.
select
  user_id,
  created_at,
  estimated_cost as logged_cost,
  greatest(duration_minutes * 60, 10) / 3600.0 * 0.04 as corrected_cost
from usage_logs;
```

```sql
-- 2. monthly cost per user (transcription + LLM)
create or replace view user_monthly_cost as
select user_id, date_trunc('month', created_at) as month, sum(estimated_cost) as cost
from (
  select user_id, created_at, estimated_cost from usage_logs
  union all
  select user_id, created_at, estimated_cost from llm_usage_logs
) t
group by 1, 2;
```

```sql
-- 3. heaviest users this month
select user_id, cost
from user_monthly_cost
where month = date_trunc('month', now())
order by cost desc
limit 20;
```

```sql
-- 4. LLM cost split by feature (ask vs inline-edit vs transformation)
select feature, model, count(*) as calls,
       sum(input_tokens) as in_tokens, sum(output_tokens) as out_tokens,
       sum(estimated_cost) as cost
from llm_usage_logs
where created_at >= date_trunc('month', now())
group by 1, 2
order by cost desc;
```

Subscription state lives in the website repo's `users` table (`subscription_tier`, `subscription_period_end`, `trial_ends_at`); there is no separate subscriptions table. Trial users have access via `trial_ends_at` while tier is `free`, so paying vs trial is:

```sql
-- 5. cost this month: paying vs trial vs neither
select
  case
    when u.subscription_tier = 'pro' then 'paying'
    when u.trial_ends_at is not null then 'trial'
    else 'free'
  end as cohort,
  count(distinct c.user_id) as users,
  sum(c.cost) as cost
from user_monthly_cost c
join users u on u.id = c.user_id
where c.month = date_trunc('month', now())
group by 1;
```

Revenue per paying user comes from the Dodo product price (confirm the current Pro price; code comments say $7/month). Margin = price - cost.

## Calibration

After deploy, compare `sum(cost)` from `user_monthly_cost` against the Groq console invoice for the same month. The gap is the unmodelled part (browser search tool fee, BYOK usage, lost client-side inserts).

## Out of scope

- Browser search tool fee: undocumented, measure from the invoice first.
- Server-side logging in the proxy (source of truth, immune to dropped client inserts): website repo.
- `max_tokens` / `reasoning_effort: low` on Ask: cost risk is tiny, product call.
- Ask question counter: separate decision.

## Open questions

- BYOK is commented out, so every logged call is on our key. No BYOK handling needed.
- Qwen is Preview and may be repriced or removed; vision support is unconfirmed in docs, so test against the live API.

## Review

Cost is now computed and logged server-side in the website proxy (source of truth); the desktop app no longer inserts rows for proxy calls.

Desktop (`feat/accurate-usage-cost-tracking`):
- Proxy requests send `feature` (LLM: 'ask' | 'inline-edit' | 'transformation'; transcription: 'transcription'), which tells the proxy to log.
- Client-side LLM inserts removed from `commands.ts`, `delivery.ts`, `transformer.ts`.
- Client-side transcription tracking now only runs for direct calls with the user's own Groq key; `usage-tracking.ts` is model-aware (turbo/v3, 10s minimum, Qwen price) for that path.
- svelte-check: no errors in changed files (70 pre-existing elsewhere).

Website (`noteflux--`, branch `feat/server-side-usage-logging`):
- `lib/usage-log.ts` (new): prices and inserts usage rows with the admin client, stores `model` and `source = 'server'`, and keeps `total_usage_limit` updated for transcription.
- `app/api/groq/chat` logs the model that actually ran (Qwen when an image is attached); `app/api/groq/transcribe` requests `verbose_json` to get billed duration.
- `docs/sql/20261015_usage_cost_tracking.sql`: columns, indexes, views, optional backfill.

Rollout order: run the SQL, deploy the website, ship the desktop release. Opt-in via `feature` means old clients keep logging themselves, so nothing is double counted.

Not done: tightening RLS so users can't insert their own usage rows (only safe once old clients are gone); end-to-end test against the live proxy.
