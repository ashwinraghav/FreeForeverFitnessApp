# @freeforever/data

The shapes everything else agrees on: schemas, ids, units, and the sync engine.
**AGPL-3.0** — this one encodes the product, not reusable maths.

## What is in here

```
src/schemas/   workout, exercise, nutrition, body, profile, records, routine, habits, grants
src/common/    ids, units, time, sortKey, envelope
src/sync/      the sync engine and the App Check guard
aggregates.ts  the locally-materialised aggregate contracts
collections.ts the Firestore layout
```

Three pieces carry more weight than their size suggests:

- **`common/sortKey.ts`** — sets are ordered by a fractional index, never an array
  position. Two devices inserting a set between the same pair must not fight, and the
  arithmetic that derives a key from two neighbours is the thing that stops it
  ([ADR-0025](../../docs/decisions/0025-conflict-resolution-per-data-class.md)).
- **`common/envelope.ts`** — every stored document is versioned. Reading an envelope from
  a future version has to degrade, not throw.
- **`sync/appCheck.ts`** — the guard that decides whether a request is allowed to reach
  Firestore at all. Its tests run against the emulator, in a separate vitest project, and
  are invisible to a plain `pnpm test` — which is why CI names them explicitly.

## Rules for changing it

**A schema change is a migration.** Documents already written by an installed app do not
change shape because you changed a type. Bump the envelope version and handle the old one.

**Ids are opaque and branded.** `ExerciseId` is a branded string, and a logged set stores
the id it pointed at. Renaming an id orphans somebody's history — this is why the merged
exercise catalogue keeps the hand-written ids and folds the dataset in behind them.

**Security rules are part of this package's surface.** `firestore.rules` and
`storage.rules` are readable by any attacker, so their tests block CI
([ADR-0015](../../docs/decisions/0015-public-rules-need-tests.md), and
[ADR-0023](../../docs/decisions/0023-storage-rules-are-security-surface.md) for why
Storage needed saying separately — its ruleset was missing while every Firestore rule was
carefully tested).

## Running it

```bash
pnpm --filter @freeforever/data test        # unit only, no emulator
pnpm --filter @freeforever/data test:sync   # the sync suites
pnpm emulators                              # needed for the rules tests
pnpm --filter @freeforever/data test:rules
```
