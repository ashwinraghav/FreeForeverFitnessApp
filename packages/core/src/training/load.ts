import type { Load, LoadContext } from './types.js';

/**
 * Turning the {@link Load} union into one number of kilograms.
 *
 * This is the single place the four loading modes are collapsed, and everything
 * downstream — volume, e1RM, personal records, progression — goes through it. The
 * union exists because assisted work *inverts*: an assisted pull-up gets lighter as
 * the stack goes up, so a naive `weightKg` makes progress look like regression on the
 * one movement beginners use most. Collapsing it in twenty call sites would mean
 * getting the sign wrong in at least one of them.
 *
 * The function returns `null` rather than a guess whenever it cannot know the answer.
 * A bodyweight set with no recorded bodyweight has no load, and a chart that quietly
 * substitutes zero is worse than a chart with a gap in it.
 */

export interface EffectiveLoadOptions {
  /**
   * Whether `{ kind: 'none' }` means "the lifter's own bodyweight moved nothing
   * added" (the schema's stated reading, and the default) or "no load at all".
   *
   * The distinction matters for unloaded mobility work, which shares the `none`
   * load kind with a push-up. Callers that know they are summing strength volume for
   * a movement pattern rather than for a stretch can pass `false`.
   */
  readonly noneCountsBodyweight?: boolean;
}

/**
 * Kilograms actually moved by one set, or `null` when the inputs cannot say.
 *
 * `implementMassKg` is added, never assumed: `exerciseBodySchema` defines it as the
 * empty implement's mass, present only when the logged number is the plates alone.
 * Absent means the logged number is already the total.
 */
export function effectiveLoadKg(
  load: Load,
  context: LoadContext = {},
  options: EffectiveLoadOptions = {},
): number | null {
  const bar = context.implementMassKg ?? 0;
  const bodyweight = context.bodyweightKg;

  switch (load.kind) {
    case 'external':
      return round4(load.weightKg + bar);

    case 'bodyweight':
      if (bodyweight === undefined) return null;
      return round4(bodyweight + load.addedWeightKg);

    case 'assisted': {
      if (bodyweight === undefined) return null;
      // The machine takes weight *off*. Assistance heavier than the lifter is not
      // physically meaningful, but a mis-entered 200kg assistance must not produce a
      // negative load that then reads as a personal record on the way down.
      return round4(Math.max(0, bodyweight - load.assistanceKg));
    }

    case 'none':
      if ((options.noneCountsBodyweight ?? true) === false) return 0;
      return bodyweight ?? null;
  }
}

/**
 * Kilograms of external resistance, ignoring the lifter entirely.
 *
 * This is the number a plate calculator and a "did I add weight this week?" comparison
 * want: a lifter who gained 2kg of bodyweight did not add 2kg to their pull-up.
 */
export function externalLoadKg(load: Load, context: LoadContext = {}): number {
  const bar = context.implementMassKg ?? 0;
  switch (load.kind) {
    case 'external':
      return round4(load.weightKg + bar);
    case 'bodyweight':
      return round4(load.addedWeightKg);
    case 'assisted':
      return round4(-load.assistanceKg);
    case 'none':
      return 0;
  }
}

/**
 * True when a larger number on this load kind means a harder set.
 *
 * Assisted work is the exception, and it is the reason every comparison in this
 * package asks rather than assuming.
 */
export function isHeavierBetter(load: Load): boolean {
  return load.kind !== 'assisted';
}

/** Kilograms rounded to a tenth of a gram — enough to erase float noise, not data. */
export function round4(kg: number): number {
  if (!Number.isFinite(kg)) return Number.NaN;
  return Math.round(kg * 1e4) / 1e4;
}

/** Kilograms as whole grams, for arithmetic that must not drift. */
export function toGrams(kg: number): number {
  return Math.round(kg * 1000);
}

/** The inverse of {@link toGrams}. */
export function fromGrams(grams: number): number {
  return round4(grams / 1000);
}
