# ADR-0026: The licence split is a dependency constraint, not just a file header

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Workout team, ratified by the project owner with Claude Opus 5 (session 60f2e23f)
- **Relates to:** [ADR-0003](./0003-licence.md), [ADR-0025](./0025-conflict-resolution-per-data-class.md)

## Context

ADR-0003 licenses `packages/core` and `packages/design-system` under Apache-2.0 so the
genuinely reusable parts can be reused, while the application and `packages/data` are
AGPL-3.0-or-later so a hosted fork must publish its source.

That split survives only as long as the Apache packages take no AGPL dependency. An AGPL
dependency is not a footnote: it places the distribution of the combined work under the
AGPL, so an Apache-licensed package that imports one is Apache in its header and AGPL in
practice.

This nearly happened. After ADR-0025 established `isVolumeEligible` as the canonical
predicate, the integrator asked both call sites to import it from `@freeforever/data`.
For the sync engine that is correct — it lives inside `packages/data`. For
`packages/core` it would have relicensed the package. The workout team declined the
instruction and explained why, which is the only reason it was caught: nothing in CI
checks licence compatibility, and the import would have looked like exactly the
consolidation we asked for.

## Decision

**No Apache-2.0 package in this repository may depend on an AGPL one.** `packages/core`
and `packages/design-system` keep zero dependencies on `packages/data`, `apps/**` or
`functions/**`.

Where they need a definition that `packages/data` owns, they **restate it and prove
equivalence one layer up**, in a package that legitimately depends on both. For
`isVolumeEligible`, `apps/web` asserts that `core`'s and `data`'s implementations agree
across all 24 state × type combinations, and separately pins the intended divergence
between `isVolumeEligible` and `isRecordEligible` so the two cannot silently collapse
into one.

The same pattern already applies to types: `packages/core/src/training/types.ts` and
`nutrition/types.ts` mirror the schemas rather than importing them, for this reason.

## Consequences

The licence split stays real rather than nominal, and `packages/core` remains something
another project can take.

The guarantee is different from an import but not weaker. An import makes two call sites
the same function; the equivalence test makes them the same behaviour on every input that
exists. It costs a duplicated definition and a test that must be remembered when either
side changes — the test failing is what remembers it.

The residual risk is that a future contributor consolidates the duplication in good
faith. That is precisely what happened here, from the integrator, and it was caught only
by a person who knew the licences. **A lint rule forbidding `@freeforever/data` imports
inside Apache-licensed packages would make this structural rather than cultural, and
should be written.**

## Alternatives considered

Relicensing `packages/core` as AGPL to permit the import. Rejected — it would surrender
the reusability that is the entire point of the split, to save one duplicated
seven-line predicate.

Moving the shared predicates into a third Apache-licensed package that both depend on.
Viable and arguably cleanest, but a package created to hold two predicates is overhead
today; revisit if the mirrored surface grows.
