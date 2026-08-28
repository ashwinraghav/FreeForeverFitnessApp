import { addNutrients, roundTo, zeroNutrients } from './nutrients.js';
import { KCAL_PER_GRAM, type MacroTargetValues, type NutrientProfile } from './types.js';

/**
 * Day roll-up and the daily view's arithmetic.
 *
 * Totals are computed by summing the *stored* absolute values on each entry,
 * never by re-deriving them from the food. That is what makes a day document
 * internally consistent: `day.totals` equals the sum of `meal.totals`, which
 * equals the sum of `entry.nutrients`, exactly, with no dependence on whether
 * the bundled index has been rebuilt since (ADR-0006, and the immutability rule
 * in `packages/data/src/schemas/nutrition.ts`).
 */

export interface EntryLike {
  nutrients: NutrientProfile;
  massG: number;
}

export interface MealLike {
  totals: NutrientProfile;
  entries: readonly EntryLike[];
}

/** Sum a meal's entries. The value stored as `meal.totals`. */
export function rollUpMeal(entries: readonly EntryLike[]): NutrientProfile {
  return entries.length === 0 ? zeroNutrients() : addNutrients(...entries.map((e) => e.nutrients));
}

/** Sum a day's meals. The value stored as `day.totals`. */
export function rollUpDay(meals: readonly MealLike[]): {
  totals: NutrientProfile;
  entryCount: number;
} {
  return {
    totals: meals.length === 0 ? zeroNutrients() : addNutrients(...meals.map((m) => m.totals)),
    entryCount: meals.reduce((n, m) => n + m.entries.length, 0),
  };
}

/** Total food mass logged on a day. Not a nutrient, but the same kind of sum. */
export function totalMassG(meals: readonly MealLike[]): number {
  return roundTo(
    meals.reduce((sum, m) => sum + m.entries.reduce((s, e) => s + e.massG, 0), 0),
    4,
  );
}

export interface MacroProgress {
  /** Canonical amount consumed. */
  consumed: number;
  /** Canonical target. */
  target: number;
  /** Signed. Negative means over target — which for energy is the interesting case. */
  remaining: number;
  /** 0..1, clamped, for the ring's filled arc. */
  fraction: number;
  /** Amount past the target, 0 when under. Drawn as a separate over-fill arc. */
  overBy: number;
  /**
   * True once consumption exceeds the target. Paired with a shape change in the
   * UI, never colour alone — ADR-0013, and it has to survive a sun-washed screen.
   */
  isOver: boolean;
}

/**
 * Progress of one quantity against one target.
 *
 * `fraction` is clamped to 1 and `overBy` carries the excess separately, so the
 * ring can draw a full arc plus an overshoot mark rather than a 140% arc that
 * wraps and reads as 40%.
 *
 * A zero or absent target yields a zero fraction rather than NaN or Infinity.
 * A user with no target set has not failed at anything.
 */
export function macroProgress(consumed: number, target: number): MacroProgress {
  const safeTarget = Number.isFinite(target) && target > 0 ? target : 0;
  const remaining = safeTarget - consumed;
  const overBy = Math.max(0, -remaining);
  return {
    consumed: roundTo(consumed, 4),
    target: roundTo(safeTarget, 4),
    remaining: roundTo(remaining, 4),
    fraction: safeTarget === 0 ? 0 : Math.min(1, Math.max(0, consumed / safeTarget)),
    overBy: roundTo(overBy, 4),
    isOver: safeTarget > 0 && consumed > safeTarget,
  };
}

export interface DaySummary {
  energy: MacroProgress;
  protein: MacroProgress;
  carbs: MacroProgress;
  fat: MacroProgress;
  fiber: MacroProgress | null;
  water: MacroProgress | null;
  /** Share of consumed energy from each macro, or null for an empty day. */
  split: { protein: number; carbs: number; fat: number } | null;
}

/**
 * Everything the daily ring and its summary rows need, in one pass.
 *
 * Fibre and water are `null` rather than a zeroed row when no target exists, so
 * the view can omit the row entirely. A row reading "0 / 0 g" is worse than no
 * row: it looks like a measurement.
 */
export function summariseDay(input: {
  totals: NutrientProfile;
  target: MacroTargetValues | undefined;
  waterMl: number;
}): DaySummary {
  const { totals, target, waterMl } = input;
  const t = target;

  return {
    energy: macroProgress(totals.energyKcal, t?.energyKcal ?? 0),
    protein: macroProgress(totals.proteinG, t?.proteinG ?? 0),
    carbs: macroProgress(totals.carbsG, t?.carbsG ?? 0),
    fat: macroProgress(totals.fatG, t?.fatG ?? 0),
    fiber:
      t?.fiberG !== undefined ? macroProgress(totals.fiberG ?? 0, t.fiberG) : null,
    water: t?.waterMl !== undefined ? macroProgress(waterMl, t.waterMl) : null,
    split: consumedSplit(totals),
  };
}

/**
 * Share of *consumed* energy from each macro. Uses the stated energy rather
 * than the Atwater sum so the split matches the number on the ring; a day whose
 * foods disagree with their own macros should not also have a split that
 * disagrees with its own total.
 */
export function consumedSplit(
  totals: NutrientProfile,
): { protein: number; carbs: number; fat: number } | null {
  if (totals.energyKcal <= 0) return null;
  return {
    protein: (totals.proteinG * KCAL_PER_GRAM.protein) / totals.energyKcal,
    carbs: (totals.carbsG * KCAL_PER_GRAM.carb) / totals.energyKcal,
    fat: (totals.fatG * KCAL_PER_GRAM.fat) / totals.energyKcal,
  };
}

/**
 * Energy left before the target, floored at zero for the "you can still eat"
 * affordance. `summariseDay().energy.remaining` keeps the signed value for
 * anywhere the overshoot matters.
 */
export function energyRemainingKcal(totals: NutrientProfile, target?: MacroTargetValues): number {
  if (!target) return 0;
  return Math.max(0, roundTo(target.energyKcal - totals.energyKcal, 0));
}
