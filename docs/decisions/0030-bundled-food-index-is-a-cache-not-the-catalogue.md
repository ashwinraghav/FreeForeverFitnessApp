# ADR-0030: The bundled food index is a cache, not the catalogue

- **Status:** Accepted; **rule 3 superseded by [ADR-0033](./0033-reach-is-a-download-problem-not-a-network-one.md)**
  (2026-08-31). Rules 1 and 2 stand. Rule 3's premise — that a browser-direct call to Open Food
  Facts is free and therefore bounded — is false: OFF's terms forbid the use, and *free to us* is
  not *bounded*. The text below is left unedited on purpose.
- **Date:** 2026-08-31
- **Decided by:** Project owner, with Claude Opus 5 (session 60f2e23f)

## Context

The food index build ranks 505,482 deduplicated, quality-gated records and ships the top
98,267 in a fixed 4 MB gzip budget. The remaining **407,215 records are dropped for budget**
(core 257,356, off 149,859). They passed every gate — valid serving grams, a serving label,
internally consistent macros — and are then unreachable, because the nutrition runtime makes
no network calls at all: no OFF API, and no OFF origin in the production `connect-src`.

The practical consequence is that a food absent from the shipped slice does not exist to the
app. There is no "no results, try online" path. There is only "no results".

Ranking made this worse along one specific axis. `rank.mjs` scores each record by
`localeFit`, which awards 1.0 to a locale match and 0.2 otherwise; the build defaulted to
`--locale us`. Measured on the shipped OFF shard by GS1 barcode prefix, roughly 40% of
records are US/Canada and **450 (0.70%) are Indian**, for a project whose owner is in India.
The datasets team had flagged this in a code comment as "a known bias, not an oversight".

The project owner then set the governing constraint: *"all country products are visible
everywhere. Visibility should not be restricted as a result."*

That constraint cannot be satisfied by re-weighting `localeFit`, and it cannot be satisfied by
a per-locale build matrix — both only change *which* records fall off the cliff. It can only be
satisfied by removing the cliff.

## Decision

**The bundled index is reclassified from catalogue to cache.** It is a pre-warmed, offline-first
slice of the corpus, not the set of foods that exist. Search resolves locally first and may fall
back to an on-demand lookup against Open Food Facts' public API for queries the local slice
cannot satisfy.

Three rules follow, in priority order:

1. **Locale may rank and may pre-cache. Locale must never gate existence.** A per-locale build
   that omits other regions' products is forbidden. Locale weighting is legitimate only as a
   cache-warming policy — deciding what is instantly available offline, never what is reachable.
2. **Local-first is not negotiable.** The bundled slice must return a good answer standalone,
   offline, with no network — consistent with ADR-0016's zero-cost-path-first rule. A remote
   fallback compensating for weak local ranking is a defect, not a design: it fails precisely in
   the gym-basement case the app exists for. Search quality is measured against the local slice
   with the network disabled.
3. **The fallback must not transit our infrastructure.** The request goes from the user's browser
   directly to Open Food Facts. It adds no Firebase egress and no per-user cost, so ADR-0001
   holds. Proxying it through our project would convert a free feature into an unbounded per-user
   cost and is therefore forbidden — which also means we cannot hide the third-party call behind
   our own origin.

## Consequences

Rule 3 has a privacy cost that rule 3 also prevents us from engineering away: **a fallback search
sends the user's query to a third party.** This must be disclosed and must not be silent. The
local path stays the default so that the common case never leaves the device.

The production CSP needs an OFF origin in `connect-src` (integrator-owned). Adding a third-party
origin is a security-surface change and belongs in the ownership audit of ADR-0023.

ODbL attribution already ships for the bundled OFF shard; on-demand results carry the same
obligation and must not bypass it.

Offline behaviour becomes a visible product state rather than an invisible one: with no network,
the app is honestly limited to the cached slice, and should say so rather than reporting that a
food does not exist.

The 4 MB budget stops being a coverage ceiling and becomes a latency-and-offline optimisation.
This makes the budget a tuning parameter rather than a product constraint, and makes the core
(whole-foods, locale-independent) shard more valuable per byte than the branded shard.

## Alternatives considered

**Re-rank with `--locale in`** (rejected: one flag, ~14 minutes, and it merely moves the cliff —
US products would become the invisible ones, violating the owner's constraint symmetrically).

**Per-locale build matrix** (rejected: same objection, made structural; explicitly ruled out).

**Raise the budget to fit all 505,482 records** (rejected: ~20 MB on every device including
metered connections, for a corpus with a long tail almost nobody queries).

**Proxy the OFF lookup through Cloud Run** (rejected under ADR-0001: converts a free,
client-direct request into metered per-user egress on our account, for a privacy benefit we can
obtain more honestly by disclosure and by keeping local-first the default).

**Opt-in downloadable regional packs** (not rejected — deferred. Preserves offline reach without a
network dependency and remains a good complement to the fallback rather than a substitute for it,
since it still cannot cover the full corpus.)
