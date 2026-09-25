# Action Mode reliability — research notes (for when we resume)

Action Mode itself is stashed (`stash@{0}`, "Action Mode: Jev integration,
allow-list, risk-gate, BFS depth fix"). This doc is just the findings from
reading real macOS-Jev-automation repos, so the reasoning isn't lost before
we pick this back up. Not urgent — current priority is testing the payment
flow and shipping a demo with what's solid today.

## Why our Action Mode wasn't reliable — real finding, not a guess

Read `kevinbadi/jev-voice` (67★, "Talk to your Mac. Local whisper.cpp + one
Jev call per command + macOS automation" — closest real match to what we're
building) closely. The gap isn't a testing problem, it's architectural:

**What we do today**: every single voice command goes through the hardest
possible path — enumerate the whole AX tree of the frontmost app, ask Jev to
pick a button from the enumerated list. No cheaper path for common cases, no
escalation when Jev's unsure, no verification the action actually worked.

**What jev-voice does**: Jev's job is narrow — classify *which kind* of
command this is (~15 known categories: open_app, shortcut, type_text,
volume, media, system, etc. — see `jev_voice/brain.py` `ACTIONS` dict) and
pick among small, **code-generated** candidate lists (installed app names,
known keyboard shortcuts via a fixed dict, regex-extracted text spans from
the utterance — never freeform-generated text). Deterministic code then
executes via known native APIs (`NSWorkspace` launch, `CGEvent` key presses,
System Events) — no AX-tree walking involved for any of that. Generic
"find and click an arbitrary button in an arbitrary app" is reserved for
their hardest fallback category (`task`) only, and even that gets escalated
to a real LLM with screenshot verification before being trusted.

We built only the least-reliable tier of a design that, done properly, has
three tiers working together.

## The three-tier pattern, confirmed as real working code (not hypothetical)

Matches the original three-layer idea from the very start of this feature
(deterministic rules → Jev → expensive model):

1. **Deterministic code** — common commands (open app, press shortcut, type
   text, adjust volume) handled via known native APIs, no AI at all beyond
   Jev picking *which* known thing from a small closed set.
2. **Jev** — cheap, fast classification + picking among code-generated
   candidates. Never asked to generate free text or handle open-ended UI
   discovery directly.
3. **Real LLM escalation** (`jev_voice/escalate.py`, Claude — haiku-4-5 fast
   tier, fable-5-1/opus-5 strong tier) — only invoked when Jev's confidence
   is below a threshold, or to **verify** a completed action actually
   reached the goal state (sends a real screenshot to Claude and asks "did
   this actually work, not just plausibly look done"). This is the
   verification layer we don't have at all today — we fire `perform_action`
   and trust the Result, no check that anything actually happened.

## Smaller concrete fixes, worth grabbing independent of the bigger redesign

- Their confidence threshold is `YES = 0.6` (`jev_voice/config.py`). Ours is
  an uncalibrated `0.5` guess in `action-mode/desktop.ts`. Worth bumping,
  though still not a measured value either way.
- They keep the HTTP client's TCP+TLS connection warm in the constructor
  (`Brain.__init__` does a throwaway GET on startup). We construct a fresh
  `TypeSafeClient` on every single `performActionFromTranscript` call —
  real, avoidable per-call latency.
- "Select, don't generate" — Jev should only ever pick among candidates code
  already produced, never freeform-generate a label or value. We already do
  this for element selection; worth keeping as a hard rule if we add any
  text-generation-adjacent step later (e.g. the deferred press-then-type
  compound-command feature).
- `savka777/jev-use`'s docs mention TypeSafe's Choice questions cap at 255
  options — our `list_actionable_elements` has no cap on element count
  before building the criteria object. Untested whether we'd ever actually
  hit this (BFS budget is 600 nodes, not all become criteria entries since
  only AXPress elements with a label qualify), but worth checking before
  assuming it's fine.

## Other repos worth a second look if we go deeper on this

- `dabit3/jev-experiments` (`jev-ax-pilot` subfolder) — 362★, reads AX tree
  into flattened JSON, executes via `AXUIElementPerformAction` +
  `AXUIElementSetAttributeValue` (text-field writes — something we punted
  on for the press-then-type compound-command case) + `CGEvent`.
- `moona3k/macparakeet` — 658★, an established (pre-Jev, Feb 2026) local
  dictation Mac app, same category as NoteFlux, independently researching
  the same Jev+AX approach in `docs/research/2026-09-20-typesafe-computer-use/`.
  Worth reading their walkthrough doc specifically — it makes an explicit
  ratio claim: "roughly half the code exists to build and constrain the
  option set and verify what happened after picking from it" — i.e. the
  actual decision call is a small fraction of the real implementation.
- `NobleSpartan6/otto` — explicit design principle worth keeping verbatim:
  "Jev chooses from a bounded, concrete candidate list... never supplies
  executable selectors or arbitrary arguments." Matches our architecture,
  good north star for any redesign.

## Not decided yet — for when we come back to this

Whether to rebuild Action Mode around the three-tier pattern (bigger lift,
proper reliability) or ship the current single-tier version as-is once
retested (smaller lift, unknown reliability ceiling). Deferred until after
payment-flow testing and the demo push.
