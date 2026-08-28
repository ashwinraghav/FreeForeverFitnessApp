# ADR-0029: The domain soft-deletes; hard deletes are best-effort

- **Status:** Accepted
- **Date:** 2026-08-28
- **Decided by:** Sync team (Claude Fable 5), ratified by the project owner with Claude Opus 5 (session 60f2e23f)
- **Relates to:** [ADR-0005](./0005-firestore-is-a-sync-engine.md), [ADR-0025](./0025-conflict-resolution-per-data-class.md)

## Context

Delta sync reads changes with `where('updatedAt', '>', cursor)`. A hard-deleted document
matches no query, so a delete performed on device A is invisible to device B — and because
`repair()` rebuilds from the local cache, which still holds the stale copy, even a repair
cannot see it. Device B keeps counting a workout that no longer exists.

This was named as a structural hole by the sync team rather than discovered later, which is
the only reason it is a decision instead of a bug report.

## Decision

**The domain soft-deletes, and hard deletes are best-effort.** This is made explicit rather
than left as an accident of the current implementation.

The domain barely hard-deletes by design: a workout is retracted with `status: 'discarded'`,
a day document is emptied rather than removed. Both are *updates*, so both sync normally and
both fold through the aggregate reducers correctly. Local deletes are covered by
`engine.noteLocalDelete`, and a remote delete of a document the listener has already matched
arrives as a `removed` event within the same session.

What remains uncovered is narrow and stated plainly: **device A hard-deletes an old
document, device B never learns.** No tombstone convention, no periodic server-reconciled
listen.

## Consequences

The cost model in ADR-0005 is preserved. The two fixes both charge for a case that barely
occurs: tombstones add a write and a permanent row per deletion and need their own retention
policy; a periodic full reconciliation re-reads whole collections on a schedule, billing per
document, which is precisely the unbounded per-user cost constitution rule 2 forbids.

The exposure is bounded by the domain, not by luck. Because retraction is an update, the
paths a user actually takes — discarding a workout, clearing a day — already propagate. What
does not propagate is a genuine hard delete of old data across devices, which is rare and
whose consequence is a stale aggregate on one device rather than data loss.

**A user-visible workaround exists and should be documented rather than hidden:** a device
showing a stale total converges as soon as it re-syncs from zero, and losing a cursor is
wasteful but never wrong.

## Reversal criteria

Revisit if any becomes true:

1. A feature needs real hard deletes on a common path — GDPR-style erasure of individual
   records is the likely candidate, and it would need tombstones regardless.
2. Support reports users seeing totals that disagree between devices.
3. The coach features in Phase 4 introduce documents a second party can delete, which
   changes "rare" to "routine".

## Alternatives considered

Tombstones now. Correct and complete, and rejected as premature: a permanent row and a
retention policy for every deletion, to fix a case the domain mostly avoids.

Periodic full reconciliation. Simple to implement and directly contrary to ADR-0005 — it
turns sync back into a query engine and reintroduces per-document billing on a timer.

Doing nothing and not writing this down. Rejected because that is the actual current
behaviour, and an undocumented limitation is indistinguishable from a bug nobody has hit yet.
