# ADR-0025: Conflict resolution is decided per data class

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Project owner, with Claude Fable 5 (sync team) and Claude Opus 5 (session 60f2e23f)
- **Relates to:** [ADR-0005](./0005-firestore-is-a-sync-engine.md), [ADR-0009](./0009-anonymous-first-auth.md)

## Context

Firestore resolves concurrent writes to one document as last-writer-wins over the whole
document. For some of our data that is correct. For others it is silent data loss, and the loss
is somebody's training or food log — the thing the app exists to keep.

There are two distinct conflict surfaces and they need different treatment.

**Create/create collisions** are inevitable wherever the document id is derived rather than
random: two devices that both logged Tuesday address `nutritionDays/2026-08-24`. This surface
has a hook — the losing create drains as an invalid update, the rules reject a fresh `createdAt`
on an existing document, and the resulting `permission-denied` is catchable.

**Update/update while both devices are offline** has no hook. Both writes are individually
valid, the server cannot refuse either, and transactions do not work offline.

## Decision

Policy is explicit per data class, enforced in `merge.ts` at the single place writes happen.
The governing line: **last-writer-wins where a concurrent edit would require the same human in
two places at once; a real merge where the document id makes collision the normal case; a
semilattice join where the data has a natural "best".**

| Class | Policy |
|---|---|
| `workouts`, `routines` | LWW whole-document. Random ids, so the realistic two-device case is two different sessions. Inventing a merged workout nobody performed is worse than losing a rare concurrent edit. |
| `exercises`, `foods`, `recipes`, `macroTargets`, `habits` | LWW whole-document. Single-author library documents; a concurrent edit is one person contradicting themselves and their latest intent should win. |
| `profile` | LWW, local-biased on create collision. |
| `nutritionDays` | **Union merge.** Meals by id, entries by id within a meal; totals and `entryCount` recomputed from the union, never summed across inputs; `waterMl` = max. The id is a date, so collision is the normal case and LWW here literally eats someone's lunch. |
| `habitDays` | Union by habit id. An answered entry beats `pending`; two answers resolve by later `completedAt`. "Did it" must survive "haven't yet". |
| `bodyMetrics` | Field-wise by `measuredAt`. An evening weigh-in must not erase the morning's tape measurements. |
| `personalRecords` | **Semilattice join.** Higher value wins per PR type, ties to the earlier `achievedAt` — the record belongs to whoever set it first. Commutative, associative, idempotent, so offline devices converge in any order. |
| `aggregates` | LWW, deliberately. Derived data; the loser's next fold or `repair()` reconverges. Merging a cache is complexity protecting nothing. |

On a denied create, the write layer fetches the winner, merges under the class policy, and
retries as a well-formed update. Nothing is lost. This mechanism depends on `createdAt`
immutability in `firestore.rules`, which is domain-model's to preserve — **changing that rule
breaks conflict recovery**, which is why it is recorded here rather than only in the rules file.

**All application writes must go through `engine.writeContext()`.** This is not style. A
pending offline write carries an unresolved `serverTimestamp()` sentinel, which reads locally as
`null`, and `null > cursor` is false — so a delta-sync listener querying
`where('updatedAt', '>', cursor)` **cannot see the device's own pending writes**. Verified
empirically against the emulator. The write layer therefore hands each validated document
synchronously to the aggregate engine at the moment of the tap; the listener re-delivers it
after the server acknowledges, and replace-by-id absorbs the duplicate. A feature writing to
Firestore directly would get charts that silently lag until reconnect and no conflict recovery.

## Consequences

Concurrent use across two devices does not lose logged data, and the property is testable —
the emulator suite proves the nutrition-day and personal-record cases end to end.

**Two residual risks, stated rather than hidden.** Update/update on an existing day document
(device A adds lunch, device B adds dinner, both offline) is LWW, and one meal is lost until the
losing device next writes that day. Closing it needs per-entry subdocuments, which `SCHEMA.md`
rejected on cost. And a hard delete performed on another device does not propagate, because a
deleted document matches no delta query — see the separate ADR that decision needs.

The cost: `merge.ts` is genuinely intricate, and it is the file where a well-meaning
simplification does the most damage. Someone will eventually "fix" the nutrition-day merge to
plain LWW or "improve" workouts to a merge. Both would be wrong, and this table is the reason
why.

## Alternatives considered

Uniform LWW everywhere — simple, and it silently eats meals and personal records.

CRDTs throughout — correct by construction, but every document grows metadata forever, which
collides directly with ADR-0005's cost model and the 1 MiB document limit. The semilattice join
on personal records is the one place the data was already a natural lattice, so it costs nothing
there.

Transactions — do not work offline, which is the case that matters.
