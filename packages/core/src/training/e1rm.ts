/**
 * Estimated one-rep max.
 *
 * Seven published formulas, all of them fitted to different populations on different
 * lifts, none of them right. They are here as a set rather than as one blessed
 * function because they disagree by up to 10% at eight reps and the disagreement is
 * the honest part: a user comparing this week's estimate to last week's needs the
 * *same* formula both weeks far more than they need the best one.
 *
 * Four rules hold for every formula in this file:
 *
 *   1. **One rep returns the weight, exactly.** Epley says a single is 3.3% heavier
 *      than itself; Lombardi says the same. A lifter who actually pulled a true
 *      single and sees a bigger number than the one on the bar stops trusting the
 *      screen, and they are right to.
 *   2. **Zero reps has no estimate.** A set that did not happen is not evidence.
 *      `null`, never zero — zero is a load, and a chart that plots it draws a cliff.
 *   3. **A formula outside its domain returns `null`, not Infinity.** Brzycki's
 *      denominator reaches zero at 37 reps and goes negative after; Lander's at 38.
 *      Both would otherwise emit a negative or infinite "personal record".
 *   4. **Load must be a finite, non-negative number.** Assisted work resolves to a
 *      positive effective load upstream (see `load.ts`); anything else is a bug
 *      caught here rather than plotted.
 */

export const E1RM_FORMULA_NAMES = [
  'epley',
  'brzycki',
  'lombardi',
  'mayhew',
  'oconner',
  'wathan',
  'lander',
] as const;

export type E1rmFormula = (typeof E1RM_FORMULA_NAMES)[number];

/**
 * The default. Epley is the most widely reproduced, is monotonic in reps for the whole
 * usable range, and has no domain hole — a formula that can divide by zero is a poor
 * default however good its fit.
 */
export const DEFAULT_E1RM_FORMULA: E1rmFormula = 'epley';

/**
 * Beyond this the estimates diverge from each other by more than they diverge from
 * the truth. Nothing refuses to compute above it; {@link isReliableRepRange} exists
 * so a UI can mark the number as an estimate of an estimate.
 */
export const MAX_RELIABLE_REPS = 12;

/** Whether an estimate at this rep count is worth showing without a caveat. */
export function isReliableRepRange(reps: number): boolean {
  return Number.isInteger(reps) && reps >= 1 && reps <= MAX_RELIABLE_REPS;
}

/**
 * Multiplier from a set at `reps` to a one-rep max, or `null` outside the formula's
 * domain. Exposed because the inverse direction (`loadForReps`) needs it, and because
 * a percentage table is the same numbers read the other way.
 */
export function oneRepMaxMultiplier(reps: number, formula: E1rmFormula): number | null {
  if (!Number.isInteger(reps) || reps < 1) return null;
  if (reps === 1) return 1;

  switch (formula) {
    case 'epley':
      return 1 + reps / 30;

    case 'brzycki': {
      const denominator = 37 - reps;
      // Zero at 37 reps, negative past it. A "1RM" of -400kg is worse than no number.
      if (denominator <= 0) return null;
      return 36 / denominator;
    }

    case 'lombardi':
      return Math.pow(reps, 0.1);

    case 'mayhew':
      return 100 / (52.2 + 41.9 * Math.exp(-0.055 * reps));

    case 'oconner':
      return 1 + reps / 40;

    case 'wathan':
      return 100 / (48.8 + 53.8 * Math.exp(-0.075 * reps));

    case 'lander': {
      const denominator = 101.3 - 2.67123 * reps;
      // Zero just past 37 reps; same failure mode as Brzycki.
      if (denominator <= 0) return null;
      return 100 / denominator;
    }
  }
}

/**
 * Estimated one-rep max in kilograms, or `null` when there is no honest estimate.
 *
 * @param loadKg effective load actually moved — run the {@link Load} union through
 *               `effectiveLoadKg` first, never the raw `weightKg`.
 */
export function estimateOneRepMax(
  loadKg: number,
  reps: number,
  formula: E1rmFormula = DEFAULT_E1RM_FORMULA,
): number | null {
  if (!Number.isFinite(loadKg) || loadKg < 0) return null;
  const multiplier = oneRepMaxMultiplier(reps, formula);
  if (multiplier === null) return null;
  return round2(loadKg * multiplier);
}

/**
 * Estimated heaviest load for exactly `targetReps`, derived through a one-rep max.
 *
 * Both directions use the same multiplier, so `estimateRepMax(w, r, r)` returns `w`
 * for every formula and every rep count in domain. That round trip is asserted.
 */
export function estimateRepMax(
  loadKg: number,
  reps: number,
  targetReps: number,
  formula: E1rmFormula = DEFAULT_E1RM_FORMULA,
): number | null {
  const oneRepMax = estimateOneRepMax(loadKg, reps, formula);
  if (oneRepMax === null) return null;
  return loadForReps(oneRepMax, targetReps, formula);
}

/** The load a given one-rep max predicts for `reps` reps. The inverse direction. */
export function loadForReps(
  oneRepMaxKg: number,
  reps: number,
  formula: E1rmFormula = DEFAULT_E1RM_FORMULA,
): number | null {
  if (!Number.isFinite(oneRepMaxKg) || oneRepMaxKg < 0) return null;
  const multiplier = oneRepMaxMultiplier(reps, formula);
  if (multiplier === null || multiplier <= 0) return null;
  return round2(oneRepMaxKg / multiplier);
}

/**
 * How many reps this load predicts, given a one-rep max. Returns the largest rep
 * count whose predicted load is still at or above `loadKg`, so it is a floor rather
 * than a rounded guess — telling a lifter they have nine in the tank when they have
 * eight is the error that gets someone stapled.
 */
export function repsAtLoad(
  oneRepMaxKg: number,
  loadKg: number,
  formula: E1rmFormula = DEFAULT_E1RM_FORMULA,
): number | null {
  if (!Number.isFinite(oneRepMaxKg) || oneRepMaxKg <= 0) return null;
  if (!Number.isFinite(loadKg) || loadKg <= 0) return null;
  if (loadKg > oneRepMaxKg) return 0;

  let best = 0;
  for (let reps = 1; reps <= 30; reps += 1) {
    const predicted = loadForReps(oneRepMaxKg, reps, formula);
    if (predicted === null || predicted < loadKg) break;
    best = reps;
  }
  return best;
}

/**
 * The median across every formula that has an opinion at this rep count.
 *
 * A median rather than a mean, because Brzycki and Lander both run away at high reps
 * and one outlier should not drag the number. Useful for a one-off "roughly what is
 * my max" question; a *trend* should pick one formula and keep it.
 */
export function consensusOneRepMax(loadKg: number, reps: number): number | null {
  const estimates = E1RM_FORMULA_NAMES.map((formula) =>
    estimateOneRepMax(loadKg, reps, formula),
  ).filter((value): value is number => value !== null);

  if (estimates.length === 0) return null;
  estimates.sort((left, right) => left - right);

  const middle = estimates.length >> 1;
  if (estimates.length % 2 === 1) return round2(estimates[middle] as number);
  return round2(((estimates[middle - 1] as number) + (estimates[middle] as number)) / 2);
}

/** Two decimal places: a tenth of a kilo is below the resolution of any gym. */
function round2(kg: number): number {
  return Math.round(kg * 100) / 100;
}
