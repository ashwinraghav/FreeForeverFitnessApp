import { roundTo } from './nutrients.js';
import type { SafetyAdjustment } from './safety.js';
import { KCAL_PER_GRAM, type MacroTargetValues } from './types.js';

/**
 * Per-day target variation — calorie cycling.
 *
 * More energy on training days, less on rest days, with the weekly total
 * unchanged. It is a paid feature in the apps this one replaces and it is
 * arithmetic, which is the whole argument for shipping it free.
 *
 * Two design decisions worth stating:
 *
 * **Carbohydrate absorbs the entire swing.** Protein and fat are held constant
 * across the week, because protein requirements do not fall on a rest day and
 * the fat floor is an essential-nutrient floor, not a preference. Only
 * carbohydrate — the macro with no established minimum — moves.
 *
 * **The weekly total is preserved exactly, including after rounding.** Days are
 * rounded to whole kilocalories by largest remainder, so the seven integers sum
 * to the rounded weekly total with no drift. A cycling plan whose week quietly
 * totals 40 kcal more than maintenance is a plan that stops working in month
 * three for a reason the user cannot see.
 */

export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type IsoWeekday = (typeof ISO_WEEKDAYS)[number];

/** Beyond a quarter, the low day stops being a day of eating and starts being a fast. */
export const MAX_SWING_FRACTION = 0.25;

export interface DayVariationPlan {
  /** ISO weekday numbers, 1 = Monday. Empty or all seven means no variation. */
  trainingDays: readonly IsoWeekday[];
  /** Share of base daily energy added to a training day. Clamped to MAX_SWING_FRACTION. */
  swingFraction: number;
}

export interface WeeklyTargetPlan {
  days: Record<IsoWeekday, MacroTargetValues>;
  /** The swing actually applied, after the floor reduced it. */
  appliedSwingFraction: number;
  adjustments: SafetyAdjustment[];
}

/**
 * Round a list of reals to integers that sum exactly to `Math.round(sum)`.
 *
 * Largest-remainder (Hamilton) apportionment. Plain per-element rounding drifts
 * by up to half a unit per element, which across seven days is enough to make a
 * cycling week not add up to the flat week it is supposed to equal.
 */
export function roundPreservingTotal(values: readonly number[]): number[] {
  const target = Math.round(values.reduce((a, b) => a + b, 0));
  const floors = values.map((v) => Math.floor(v));
  let remainder = target - floors.reduce((a, b) => a + b, 0);

  const order = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    // Ties break on index so the result is deterministic across engines.
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const out = [...floors];
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) {
    const entry = order[k];
    if (entry) out[entry.i] = (out[entry.i] ?? 0) + 1;
  }
  // A negative remainder happens when every value rounds up; take from the
  // smallest fractional parts first, which is the same rule read backwards.
  for (let k = order.length - 1; remainder < 0 && k >= 0; k--, remainder++) {
    const entry = order[k];
    if (entry) out[entry.i] = (out[entry.i] ?? 0) - 1;
  }
  return out;
}

/**
 * Build a week of targets from one base target and a training schedule.
 *
 * @param energyFloorKcal the user's binding safety floor, from `calculateMacroTarget`
 */
export function planWeeklyTargets(input: {
  base: MacroTargetValues;
  plan: DayVariationPlan;
  energyFloorKcal: number;
}): WeeklyTargetPlan {
  const { base, plan, energyFloorKcal } = input;
  const adjustments: SafetyAdjustment[] = [];

  const trainingSet = new Set<IsoWeekday>(plan.trainingDays);
  const nTraining = trainingSet.size;
  const nRest = ISO_WEEKDAYS.length - nTraining;

  const requested = Math.max(0, Math.min(MAX_SWING_FRACTION, plan.swingFraction));

  // With no rest days or no training days there is nothing to cycle between.
  if (nTraining === 0 || nRest === 0 || requested === 0) {
    return { days: flatWeek(base), appliedSwingFraction: 0, adjustments };
  }

  // A rest day may not fall below the safety floor, nor below the energy its
  // own fixed protein and fat already account for — carbohydrate cannot go
  // negative to make room.
  const macroMinimumKcal =
    base.proteinG * KCAL_PER_GRAM.protein + base.fatG * KCAL_PER_GRAM.fat;
  const lowestRestKcal = Math.max(energyFloorKcal, macroMinimumKcal);

  // R = B·(1 − s·nT/nR) ≥ L  ⟹  s ≤ (1 − L/B)·nR/nT
  const maxSwing = Math.max(0, (1 - lowestRestKcal / base.energyKcal) * (nRest / nTraining));
  const applied = Math.min(requested, maxSwing);

  if (applied < requested) {
    adjustments.push({
      code: 'day_variation_reduced_to_respect_floor',
      requested: roundTo(requested, 4),
      applied: roundTo(applied, 4),
    });
  }
  if (applied === 0) {
    return { days: flatWeek(base), appliedSwingFraction: 0, adjustments };
  }

  const trainingKcal = base.energyKcal * (1 + applied);
  const restKcal = base.energyKcal * (1 - (applied * nTraining) / nRest);

  const raw = ISO_WEEKDAYS.map((d) => (trainingSet.has(d) ? trainingKcal : restKcal));
  const rounded = roundPreservingTotal(raw);

  const days = {} as Record<IsoWeekday, MacroTargetValues>;
  ISO_WEEKDAYS.forEach((day, i) => {
    days[day] = withEnergy(base, rounded[i] ?? base.energyKcal);
  });

  return { days, appliedSwingFraction: roundTo(applied, 4), adjustments };
}

/**
 * The same target on every day. Also what a user gets when they have not set a
 * schedule, which is most users, which is why it is not an error case.
 */
export function flatWeek(base: MacroTargetValues): Record<IsoWeekday, MacroTargetValues> {
  const days = {} as Record<IsoWeekday, MacroTargetValues>;
  for (const day of ISO_WEEKDAYS) days[day] = { ...base };
  return days;
}

/**
 * Re-express a target at a different energy level, holding protein, fat, fibre
 * and water fixed and moving the difference into carbohydrate.
 */
export function withEnergy(base: MacroTargetValues, energyKcal: number): MacroTargetValues {
  const fixedKcal = base.proteinG * KCAL_PER_GRAM.protein + base.fatG * KCAL_PER_GRAM.fat;
  const carbsG = Math.max(0, (energyKcal - fixedKcal) / KCAL_PER_GRAM.carb);
  return {
    energyKcal: roundTo(energyKcal, 0),
    proteinG: base.proteinG,
    carbsG: roundTo(carbsG, 1),
    fatG: base.fatG,
    ...(base.fiberG !== undefined ? { fiberG: base.fiberG } : {}),
    ...(base.waterMl !== undefined ? { waterMl: base.waterMl } : {}),
  };
}

/** ISO weekday for a `YYYY-MM-DD` local date. 1 = Monday, 7 = Sunday. */
export function isoWeekdayOf(localDate: string): IsoWeekday {
  const [y, m, d] = localDate.split('-').map(Number);
  // UTC on purpose: the string is already local, so re-interpreting it in the
  // device's zone would shift the weekday for anyone east or west of it.
  const dow = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return (dow === 0 ? 7 : dow) as IsoWeekday;
}

/** The target in force on a given local date, given a weekly plan. */
export function targetForDate(
  days: Record<IsoWeekday, MacroTargetValues>,
  localDate: string,
): MacroTargetValues {
  return days[isoWeekdayOf(localDate)];
}
