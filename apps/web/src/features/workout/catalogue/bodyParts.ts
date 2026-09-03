import type { MuscleGroup } from '@freeforever/data';

import type { CatalogueEntry } from './types.js';

/**
 * Filtering the picker by what you are training today.
 *
 * ## These are training days, not body parts
 *
 * The groups below are the push/pull/legs split, which is how people actually decide
 * what to do: triceps go with chest and shoulders because they are already working
 * through every press, and biceps go with back because they are already working through
 * every row. Filtering by one muscle at a time would be a taxonomy; this is a session.
 *
 * **Rear delts are in `pull`, not `push`.** They work hardest in rows and pull-ups
 * rather than overhead pressing, so the standard advice puts them on pull day. Most
 * apps cannot express that because they model "shoulders" as one thing; `MUSCLE_GROUPS`
 * splits the three heads, which is the whole reason that split is available here.
 *
 * ## Membership is the leading muscle, and why it cannot be a threshold
 *
 * The two halves of the catalogue use incompatible scales. The hand-written seventy
 * carry graded fractions authored by a human (1, 0.8, 0.7 … 0.2); the ~840 adapted rows
 * only ever carry 1.0 for an upstream primary and 0.5 for a secondary, because that is
 * all the upstream data says (`fromDatasets.ts`).
 *
 * So a fixed threshold cannot work for both. Measured: `fraction >= 0.5` matches every
 * muscle an exercise lists at all, which put **419 of 913** exercises under an "arms"
 * filter — barbell rows included, because they list biceps secondary. A filter that
 * matches half the catalogue is not a filter.
 *
 * The rule instead is relative: a muscle counts when it is at least
 * {@link LEADING_BAND} of the exercise's largest contribution. That is scale-free — it
 * asks "is this what the exercise is *for*", which is the question the chip is asking —
 * and on the adapted rows it excludes 0.5 secondaries automatically, since 0.5 is below
 * 0.75 of 1.0.
 *
 * Measured over all 913: 269 chest-and-shoulders, 204 back-and-biceps, 314 legs, 122
 * core. Every one of the curated seventy lands in a group, only eight exercises land in
 * none (all of them `neck`), and only a handful land in two — lying rear and side
 * lateral raises, which are genuinely arguable.
 */

/** How close to the largest contribution a muscle must be to count as led-by. */
export const LEADING_BAND = 0.75;

export type BodyPart = 'push' | 'pull' | 'legs' | 'core';

export interface BodyPartFilter {
  readonly value: BodyPart;
  /** Names the pairing the way a lifter would say it, not the way a chart would. */
  readonly label: string;
  readonly muscles: readonly MuscleGroup[];
}

export const BODY_PART_FILTERS: readonly BodyPartFilter[] = [
  {
    value: 'push',
    label: 'Chest & shoulders',
    // Triceps belong here: they are already working through every press.
    muscles: ['chest', 'front_delts', 'side_delts', 'triceps'],
  },
  {
    value: 'pull',
    label: 'Back & biceps',
    // Rear delts and forearms belong here — pulling muscles, and grip work is pull work.
    muscles: ['lats', 'upper_back', 'traps', 'rear_delts', 'biceps', 'forearms'],
  },
  {
    value: 'legs',
    label: 'Legs',
    muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'],
  },
  {
    value: 'core',
    label: 'Core',
    muscles: ['abs', 'obliques', 'lower_back'],
  },
];

const MUSCLES_BY_PART = new Map<BodyPart, ReadonlySet<string>>(
  BODY_PART_FILTERS.map((filter) => [filter.value, new Set<string>(filter.muscles)]),
);

/**
 * The muscles an exercise is *for*: everything within {@link LEADING_BAND} of its
 * largest contribution.
 *
 * Reads the largest fraction rather than `muscles[0]`. The type documents that array as
 * ordered most-primary first and `starter.ts` now sorts to guarantee it — but a rule
 * that only works while an ordering contract holds is a rule with a tripwire in it, and
 * three entries had already broken that contract once.
 */
export function leadingMuscles(entry: CatalogueEntry): readonly string[] {
  let top = 0;
  for (const share of entry.muscles) if (share.fraction > top) top = share.fraction;
  if (top <= 0) return [];

  const floor = top * LEADING_BAND;
  return entry.muscles.filter((share) => share.fraction >= floor).map((share) => share.muscle);
}

/** Is this exercise one you would do on any of the given days? */
export function matchesBodyParts(
  entry: CatalogueEntry,
  parts: readonly BodyPart[],
): boolean {
  if (parts.length === 0) return true;
  const leading = leadingMuscles(entry);
  return parts.some((part) => {
    const muscles = MUSCLES_BY_PART.get(part);
    return muscles !== undefined && leading.some((muscle) => muscles.has(muscle));
  });
}
