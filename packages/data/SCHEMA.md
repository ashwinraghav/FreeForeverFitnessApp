# Firestore schema

The collection layout for TheFreeForeverFitnessApp, and why it is shaped this way.

The short version: **Firestore is a sync engine, never a query engine** (ADR-0005).
Every decision below optimises for "sync this user's deltas cheaply" and for "render
this screen from the local cache". None of them optimise for "run a query", because
running a query to draw a chart is the thing that turns a free app into a metered one.

## The cost model this is designed against

Firestore bills per document read, per document write, and per GB stored. Of those,
reads are the one that scales with *usage* rather than with data, and therefore the
one that can run away. A user opening the app twice a day for two years is roughly
1,500 sessions; if each session costs twenty reads instead of two, that is the whole
difference between a bill that rounds to zero and a bill that does not.

So there are three rules under everything here:

1. **One screen, one document.** If a screen is always read whole, it is one document.
2. **Denormalise to avoid a read**, never to avoid a computation.
3. **Nothing that renders a chart touches Firestore.** Charts read local aggregates.

## Layout

```
/users/{uid}                                  profile, preferences, units
/users/{uid}/workouts/{workoutId}             a session, with exercises and sets inline
/users/{uid}/routines/{routineId}             a routine or program, with weeks and days inline
/users/{uid}/exercises/{exerciseId}           user-authored exercises only
/users/{uid}/personalRecords/{exerciseKey}    one document per exercise, all record types
/users/{uid}/bodyMetrics/{YYYY-MM-DD}         one document per day
/users/{uid}/progressPhotos/{photoId}         metadata; the bytes live in Cloud Storage
/users/{uid}/foods/{foodId}                   user-authored and barcode-resolved foods only
/users/{uid}/recipes/{recipeId}               a recipe, with ingredients inline
/users/{uid}/nutritionDays/{YYYY-MM-DD}       one document per day, meals and entries inline
/users/{uid}/macroTargets/{targetId}          versioned targets, with effectiveFrom
/users/{uid}/habits/{habitId}                 habit definitions
/users/{uid}/habitDays/{YYYY-MM-DD}           one document per day
/users/{uid}/aggregates/{aggregateId}         synced copies of the local folds
/coachGrants/{ownerUid}__{coachUid}           explicit, scoped, revocable coach access
```

That is the whole thing. There is no top-level `exercises`, no `foods`, no `feed`, no
`users` index, and no collection that any two users can both write.

### What is deliberately not here

**The exercise catalogue and the food database.** Both ship on-device (ADR-0006).
Food search is the highest-frequency read in a nutrition app, and answering it from
Firestore would convert the core interaction into a recurring per-user cost. Only
what the user authored themselves is stored.

**A public or shared collection of any kind.** ADR-0017 rules out a public feed and a
directory; the rules have no path that two unrelated users can both read, and no way
to discover that a uid exists.

**Subcollections under a workout.** See below.

## The decisions that carry the most weight

### Sets live inside the session document

A session with forty sets is one document, not forty-one.

Sets are only ever read as part of a session, edited as part of a session, and
displayed as part of a session. Splitting them out costs a read per set on a cold
device and buys nothing, because there is no query that wants sets without their
session. It also breaks atomicity: a session and its sets written separately can
partially sync, and a half-synced session is a training log the user does not trust.

The costs of this choice, stated plainly:

- **A set completion rewrites the session document.** That is one write either way —
  Firestore bills per document write, not per byte — but it does mean a larger payload
  on the wire. At ~15KB for a long session this is not the constraint.
- **Concurrent edits from two devices resolve last-writer-wins on the whole array.**
  This is the real cost, and it is why sets carry a fractional index rather than an
  integer position: see below.
- **Security rules cannot validate a set.** The rules language has no iteration, so it
  cannot reach inside `exercises[].sets[]`. This is the weakest point in the design
  and it is documented rather than hidden. What the rules *do* enforce is everything
  an attacker could use to reach past their own data or grow a document without bound:
  ownership, server-assigned timestamps, the exact permitted key set, every top-level
  enum, and hard caps on array lengths and counters. Element-level validation is Zod's
  job, at the write boundary, in `packages/data`.

Routines make the same trade for the same reasons, as do nutrition days and habit days.

### Sets are ordered by a fractional index, not an integer

Inserting a set between set 2 and set 3 mid-workout renumbers everything after it
under an integer `order`. Since the document is the sync unit, a renumber is a rewrite
of the whole session — and two devices doing it concurrently resolve last-writer-wins:
the phone that inserted a drop set and the watch that ticked off set 5 do not merge,
one of them loses. Losing entered sets is the worst failure mode in this category.

A fractional index (`common/sortKey.ts`) gives every set a key derived only from its
two neighbours. Insertion touches one field on one set. Deletion touches nothing. Two
devices inserting into the same gap produce two different keys that both sort into
that gap, so the merge is a union: the worst case is two sets in an arbitrary but
stable order, and nothing is lost.

### Day-keyed documents use the local date as the document id

`nutritionDays`, `bodyMetrics` and `habitDays` are keyed `YYYY-MM-DD` in the user's own
timezone. Two consequences, both wanted:

- **Writes are idempotent.** Two devices that both logged Tuesday's weight converge on
  one document instead of racing a duplicate into the trend line.
- **The day boundary is the user's.** A meal at 23:40 belongs to that day and stays
  there after a flight to Tokyo. A UTC-derived date would silently move a third of the
  world's evening meals into tomorrow.

Each such document also stores `tzOffsetMinutes`, so the boundary that produced it is
reconstructable rather than inferred later from a profile that has since changed.

### Personal record ids are derived, not random

A PR document's id is `exerciseKey(ref)` — the exercise id, plus the variant id when
there is one. "Did this set beat anything?" is therefore a lookup on a known id in the
local cache, not a query. It also makes the write idempotent when two devices detect
the same PR offline.

Variants split (`bench~paused` is its own document) because a paused bench PR is not a
bench PR, and merging them makes the number meaningless.

### Logged data denormalises what it referenced

A logged set carries the exercise's name and its muscle contributions. A logged food
entry carries the food's name and its **absolute** nutrients — already multiplied out,
not per 100g and not a pointer into the bundled dataset.

This is the one denormalisation that is about correctness first and cost second. The
bundled datasets are rebuilt and reshipped (ADR-0006). If entries pointed into them,
shipping a corrected calorie figure for oat milk would rewrite what a user ate last
March. A training log that changes retroactively is not a log.

The cost benefit is real too: a nutrition day renders from one document with no
lookups, offline, on a cold cache.

### Coach grants are a top-level collection with a derived id

`/coachGrants/{ownerUid}__{coachUid}`.

Top-level, because a coach must be able to list the clients who granted them access,
and a subcollection under someone else's uid cannot be listed without already having
access to that user's data.

The id is derived rather than random because **security rules cannot run queries**. A
derived id means the rule resolves the grant with a single `get()` on a known path. A
random id would make scoped delegation impossible to express at all.

Every read rule is written `isOwner(uid) || hasGrant(uid, scope)` in that order. `||`
short-circuits, so an owner's read never performs the `get()` and never pays for it.
Only the rare coach read does.

Grants are read-only, scoped, and revocable in one write. `photos` is never implied by
another scope.

One consequence worth knowing before you write a coach-side screen: **a coach fetches
aggregates by id and does not list them.** The `aggregates` collection spans two
scopes — the nutrition fold answers to `nutrition`, the rest to `training` — and during
a query the document-id wildcard is not bound to a document, so a per-document scope
decision is undecidable and Firestore refuses the query. The rule therefore allows a
coach to list only when they hold both scopes. That is no loss in practice: the
aggregate ids are a fixed, known set, so the normal path is a `get()` per id anyway.

A second thing the rules deliberately do not police: `expiresAt` is a client-chosen
timestamp rather than a server one. It is the owner's own policy about their own data,
and nothing else reads it. The check that matters — `expiresAt > request.time` — is
made against the server's clock at read time, so a lie about the expiry cannot extend
access past the moment the server says it ended.

### Aggregates are synced even though they are computed locally

This looks like it contradicts "compute locally", and does not. A cold device that has
to replay two years of sessions to draw its first chart pays for every one of those
documents. Syncing the fold turns that into one read. The local computation stays the
source of truth; the document is a cache any client may discard and rebuild, and the
reducer's `version` field forces exactly that when the arithmetic changes.

## Which access patterns are served without a Firestore query

This is the table ADR-0005 exists to make true. Everything in the right-hand column is
computed on write into `/users/{uid}/aggregates/*` and read from the local cache. None
of it issues a Firestore query, and `features/insights` issuing one is a build failure.

| Screen / question | Served by |
|---|---|
| Weekly volume, total and per muscle group | `training_volume` aggregate |
| Hard sets per muscle per week | `training_volume` aggregate |
| Estimated 1RM over time, per exercise | `exercise_progress` aggregate |
| Best set and session volume per exercise, over time | `exercise_progress` aggregate |
| PR timeline across all exercises | `personal_records` aggregate |
| Current PRs for one exercise | the `personalRecords/{exerciseKey}` document, by id |
| Training streak, calendar heatmap | `adherence` aggregate |
| Planned vs completed sessions per week | `adherence` aggregate |
| Habit streaks | `adherence` aggregate |
| Calories and macros per day, versus target | `nutrition` aggregate |
| Protein target hit rate, logging streak | `nutrition` aggregate |
| Bodyweight trend | `bodyMetrics` documents already in cache, folded locally |
| "What did I lift last time?" | the previous `workouts` document, from cache |
| Food search | the on-device dataset (ADR-0006), not Firestore |
| Exercise search | the on-device catalogue (ADR-0006), not Firestore |

The only Firestore **queries** the app issues are:

1. A per-collection delta sync, `where('updatedAt', '>', cursor)`, which is what
   Firestore's offline persistence is actually for.
2. `coachGrants where coachUid == me` and `where ownerUid == me`, Phase 4 only, both
   single-field and both rare.

`firestore.indexes.json` therefore declares **no composite indexes**, and instead
declares single-field index exemptions for every large map and array field — session
exercises, nutrition meals, PR history, aggregate state. Firestore indexes every field
by default, including inside nested maps and arrays; exempting fields nothing ever
queries removes index storage and index-write cost for the largest fields in the
database. Adding a composite index later should be treated as a signal that something
is about to violate ADR-0005.

## The write protocol

Every synced document carries the same envelope: `sv`, `uid`, `createdAt`, `updatedAt`,
and an `id` that must equal the document id.

- **`uid` duplicates the path on purpose.** It lets a rule reject a payload that names
  someone else even when the path is the writer's own, and it makes an exported
  document self-describing without its path.
- **`createdAt` and `updatedAt` must be `serverTimestamp()`.** The rules assert
  `== request.time`, so a client-chosen time is rejected and sync ordering cannot be
  manipulated by a wrong or lying clock. Offline writes are unaffected: the sentinel
  resolves at commit.
- **`createdAt` is immutable after create.** This has a practical consequence for
  callers: **an update must not resend `createdAt`**. Use `updateDoc`, or
  `setDoc(..., { merge: true })` with a payload that omits it. A full-overwrite
  `setDoc` on an existing document must carry the stored value unchanged.
- **`updatedAt` must advance on every write**, including one that changes nothing else,
  or another device never learns the edit happened.
- **`sv` is gated by the rules** at `maxSchemaVersion()`. Deployment order is therefore
  fixed and not optional: **rules deploy before the client that writes a newer schema
  version.** The reverse order takes every write from the new client to
  `PERMISSION_DENIED`.
- **Unknown fields are rejected.** The rules use `hasAll` for required keys and
  `hasOnly` for the permitted set, so a field this schema does not define cannot be
  written. Adding a field is a rules change with a test.

There is no catch-all rule under `/users/{uid}`. An unrecognised subcollection is
denied. Adding a collection means adding a `match` block and its tests, which is
friction on purpose (ADR-0015).

## Units

Storage is always canonical; display preference lives on the profile and never touches
a stored value.

| Dimension | Canonical unit |
|---|---|
| Training load, bodyweight | kilograms |
| Food mass | grams |
| Volume | millilitres |
| Body measurements | centimetres |
| Distance | metres |
| Energy | kilocalories |
| Duration | seconds |

A number that has been converted for display is on its way to a DOM node and must
never travel back into a document. The failure this prevents is the one every fitness
app eventually ships: a user flips kg to lb, and their history silently reinterprets.

Load is a discriminated union rather than a nullable number, because assisted work
inverts: an assisted pull-up gets *lighter* as the stack goes up, so a plain `weightKg`
makes progress look like regression on the one movement beginners use most.

## Growth and retention

Free-forever rule 2 applies to bytes as well as to requests, so every unbounded
collection has a bound:

| Collection | Bound |
|---|---|
| `workouts` | 40 exercises, 50 sets per exercise, 400 sets per session; enforced in rules |
| `nutritionDays` | 12 meals, 150 entries per day; enforced in rules |
| `habitDays` | 30 entries; enforced in rules |
| `routines` | 14 days, 52 weeks; enforced in rules |
| `personalRecords` | 100 history entries per exercise; older records live in the aggregate |
| `aggregates` | per-aggregate retention in weeks, see `AGGREGATE_RETENTION_WEEKS` |
| `progressPhotos` | metadata only; image bytes are a Cloud Storage quota, not this one |

One document per day per user, across nutrition, body metrics and habits, is roughly
1,100 documents a year — small, bounded, and predictable, which is the point.

## Testing

`test/rules/*.test.ts` runs against the emulator and blocks CI (ADR-0015). It asserts
both directions for every rule: the permitted access succeeds and the forbidden access
fails. It reads the repository's real `firestore.rules`, not a copy.

The suite is mutation-checked: weakening the owner check, the uid match, the server
timestamp requirement, the unknown-field rejection, the grant status check, the grant
write authority or the scope check each makes it fail. A rules test that passes
against broken rules is not a control.

Two things the rules cannot check, stated so nobody assumes otherwise:

- **Set-level validation.** No iteration in the rules language, so `exercises[].sets[]`
  is Zod's responsibility. The rules bound the arrays and validate every top-level
  field instead.
- **Calendar validity of a date.** The regex enforces `YYYY-MM-DD` with real month and
  day ranges, so `9999-99-99` is rejected — but it cannot know February has 28 days,
  so `2026-02-30` reaches Zod. That residue affects only how a user's own days are
  filed, never who can read them.

`test/unit/rules-mirror.test.ts` checks that the enumerations hand-copied into the
rules file still match the ones in this package. A rules file cannot import
TypeScript, and a hand copy drifts; without this, an enum value added here and not
there would surface as an unexplained `PERMISSION_DENIED` in production, on a write
the user had already made.
