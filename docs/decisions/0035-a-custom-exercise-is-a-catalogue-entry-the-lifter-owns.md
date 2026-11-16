# ADR-0035: A custom exercise is a catalogue entry the lifter owns

- **Status:** Accepted
- **Date:** 2026-11-16
- **Decided by:** Project owner, with Claude Opus 5

## Context

The picker could only ever return a `CatalogueEntry`. Its contract said so —
`onPick: (entry: CatalogueEntry) => void` — and both call sites fed it from the bundled
list, so a movement the 873 did not name could not be logged at all. The search said
"Nothing matches" and suggested a shorter word, which is not advice when the word was
correct.

Three things made this a gap rather than a decision:

1. `EXERCISE_SOURCES` has listed `'catalogue' | 'custom'` since the schema was written.
2. `ExerciseCard` carries the comment "undefined for a custom exercise with no entry".
3. Nutrition already ships the same escape hatch — More offers "Add a food — for anything
   the barcode and search cannot find."

So a lifter who hit the wall in Eat learned there was a way through, hit the same wall in
Train, and found none. The shape had been agreed and the way in was never built.

## Decision

A custom exercise **is a `CatalogueEntry`**, stored on the device and prepended to the
bundled list.

- **It joins the same array.** Search, body-part chips, equipment filters, recents,
  recommendations and `toExerciseRef` all operate on it without knowing it exists. The
  alternative — a parallel list concatenated at render time — means teaching six
  consumers about a second shape.
- **Ids are `cx-<base36 time>-<base36 random>`.** This satisfies `exerciseIdSchema`
  (`^[A-Za-z0-9_-]{1,64}$`) and cannot collide with a bundled id: the dataset slugs names
  into `Ab_Crunch_Machine`, nothing in the shipped 873 begins `cx-`, and none contains
  `~`, which `exerciseKey` reserves as the variant separator.
- **Ids are never reissued or renamed.** `exerciseKey` is what a personal record is
  tracked against, so the id is in the lifter's history the moment they log a set.
  Removing a custom exercise drops it from the picker and deliberately leaves history
  alone — a logged set stores its own `name` and `muscles`, and renders without the row.
- **The form asks four questions.** Name, main muscle, what you count, how it is loaded.
  Equipment is derived, `unilateral` defaults to `false`, and every muscle past the first
  is not asked.
- **No deduplication against the bundled list.** Someone who writes down "Bench Press"
  despite the catalogue having one has said something.

The offer appears only where a typed query returns nothing, and only when the caller can
persist the result.

## Consequences

**This is the first user-authored content in the training half of the app.** Nutrition
had custom foods; training had nothing, and now has a store whose rows outlive the
bundled catalogue and are referenced by history.

**Sync will have to carry these, and currently cannot.** The store is `localStorage`,
device-local like everything else today (ADR-0005). When sync lands, a custom exercise is
a document that must travel *before* the sessions referencing it, or a lifter's history on
a second device points at an id that resolves to nothing. The denormalised `name` and
`muscles` on `ExerciseRef` mean such a session still renders — which is the safety net
working as designed, not permission to skip the ordering.

**One honest muscle instead of a split.** `muscleContributionSchema` warns that 1.0 chest
*and* 1.0 triceps double-counts every volume chart. A single named mover at 1.0 is not
that case, but it is cruder than the hand-written seventy, and volume totals for custom
exercises are correspondingly blunt. Asking a lifter to apportion fractions across
synergists mid-session would produce worse numbers, not better ones.

**`unilateral: false` can under-count.** Someone logging a single-arm movement gets one
limb's volume. Chosen because the opposite error silently inflates a total the lifter is
trying to progress, and an under-count is visible to the person who made the entry.

**A cap of 200 and a bounded name.** `localStorage` is shared with the session store, and
the worst outcome here is a custom-exercise list that fills the quota and takes an
in-progress workout with it.

**Every custom exercise is a signal.** One is either a missing alias or a missing
catalogue entry, and the name is the lifter's own word for it. Nothing reports them —
there is no telemetry and will not be — but a lifter who files one is handing over a real
gap in the datasets.

## Alternatives considered

**A separate "my exercises" screen under More**, mirroring custom foods. Rejected for the
entry point, not the screen: the moment a lifter needs this is the moment the search
failed them, mid-session, and a flow that sends them to a fourth tab to write something
down and then back to find it is a flow nobody completes. A management screen remains
worth adding; it is not the way in.

**Free text with no structure** — just a name, no muscle or load kind. Cheaper, and it
breaks the two things that make logging worth doing: volume charts need a muscle, and the
set editor needs to know whether it is counting reps or seconds. The result would be
entries that log but do not count.

**A dedicated `CustomExercise` type** rather than reusing `CatalogueEntry`. Honest about
provenance, and it would have meant a second shape in `search`, `merge`, `bodyParts`,
`recommend` and `toExerciseRef`. `source: 'custom'` on the `ExerciseRef` already records
provenance where it is actually needed — on the logged set.

**Deduplicating against the bundled catalogue** on name. Rejected for the reason
`merge.ts` gives: dropping too much is worse than two similar rows, because a dropped
exercise is invisible and the lifter simply cannot find the thing they did.
