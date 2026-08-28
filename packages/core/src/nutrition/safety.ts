import type { BiologicalSex } from './types.js';

/**
 * Safety floors on prescribed intake.
 *
 * This is a product requirement, not a nicety. A calorie target is the single
 * most load-bearing number in a body-image-adjacent product: a user who asks
 * for an aggressive deficit and is given one has been told by software that the
 * number is reasonable. So the maths refuses, visibly, and says why.
 *
 * Every constraint below is a *clamp with an explanation*, never a silent
 * substitution and never a hard refusal. Refusing to produce a number sends the
 * user to a worse calculator; producing the aggressive number they asked for is
 * worse still. Clamping and naming the clamp is the only defensible option, and
 * it is why `calculateMacroTarget` returns `adjustments` alongside `values`.
 *
 * None of this is medical advice and the app must not present it as such. These
 * are the bounds inside which a general-population estimate is defensible.
 */

/**
 * Lowest energy intake this app will prescribe, before individual factors.
 *
 * 1200 kcal (female / unspecified) and 1500 kcal (male) are the conventional
 * lower bounds for unsupervised weight loss in general-population guidance;
 * below them a diet cannot reliably meet micronutrient requirements from food.
 * `unspecified` takes the lower value so that a small person is not pushed to
 * eat more than their own maintenance — the individualised BMR floor below is
 * what actually protects them.
 */
export const ABSOLUTE_FLOOR_KCAL: Readonly<Record<BiologicalSex, number>> = {
  female: 1200,
  male: 1500,
  unspecified: 1200,
};

/**
 * Never prescribe below estimated basal metabolic rate.
 *
 * The individualised floor, and the one that usually binds. BMR is what the
 * body spends existing; a sustained intake beneath it is the regime that drives
 * lean-mass loss and metabolic adaptation. For a sedentary user (TDEE = 1.2 ×
 * BMR) this caps the achievable deficit at about 17% — which is the honest
 * answer, not a limitation of the tool.
 */
export const FLOOR_AT_FRACTION_OF_BMR = 1.0;

/** Largest deficit as a fraction of TDEE, independent of the floors above. */
export const MAX_DEFICIT_FRACTION_OF_TDEE = 0.25;

/**
 * Largest surplus as a fraction of TDEE. Asymmetric with the deficit cap on
 * purpose: beyond roughly a fifth over maintenance, additional energy reliably
 * becomes fat rather than lean mass, so a larger number is not a faster result.
 */
export const MAX_SURPLUS_FRACTION_OF_TDEE = 0.2;

/* ── Rate of bodyweight change ───────────────────────────────────────────── */

/** ~1% of bodyweight per week is the usual upper bound for preserving lean mass. */
export const MAX_LOSS_FRACTION_PER_WEEK = 0.01;
/** Absolute cap, so a very heavy user is not prescribed a 1.5 kg/week loss. */
export const MAX_LOSS_KG_PER_WEEK = 1.0;
/** Gaining faster than this adds fat, not muscle. */
export const MAX_GAIN_FRACTION_PER_WEEK = 0.005;
export const MAX_GAIN_KG_PER_WEEK = 0.5;

/** Energy in a kilogram of body tissue. The conventional mixed-tissue figure. */
export const KCAL_PER_KG_BODY_MASS = 7700;

/* ── Goal bodyweight ─────────────────────────────────────────────────────── */

/** Lower bound of the healthy BMI band. A goal weight below it is not offered. */
export const MIN_HEALTHY_BMI = 18.5;
/** Upper bound, used only to sanity-check a gain goal, never to shame one. */
export const MAX_SUPPORTED_BMI = 60;

/** Mifflin-St Jeor is validated in adults. Outside this band the estimate is flagged. */
export const MIN_VALIDATED_AGE_YEARS = 18;
export const MAX_VALIDATED_AGE_YEARS = 80;

/**
 * Every way a requested target can be altered on safety grounds.
 *
 * A closed union rather than free text so the UI can render each case with its
 * own copy and so a test can assert that a given input produces a given clamp.
 */
export type SafetyAdjustmentCode =
  | 'rate_capped_to_safe_maximum'
  | 'energy_raised_to_absolute_floor'
  | 'energy_raised_to_bmr_floor'
  | 'deficit_capped_to_fraction_of_tdee'
  | 'surplus_capped_to_fraction_of_tdee'
  | 'goal_weight_raised_to_minimum_healthy_bmi'
  | 'age_outside_validated_range'
  | 'fat_raised_to_essential_minimum'
  | 'protein_reduced_to_fit_energy_budget'
  | 'energy_raised_to_cover_macro_minimums'
  | 'day_variation_reduced_to_respect_floor';

export interface SafetyAdjustment {
  code: SafetyAdjustmentCode;
  /** What was asked for, in the unit named by the code. */
  requested: number;
  /** What is being used instead. */
  applied: number;
}

/** Fastest loss this app will prescribe for a given bodyweight, in kg/week. */
export function maxLossKgPerWeek(bodyweightKg: number): number {
  return Math.min(MAX_LOSS_KG_PER_WEEK, bodyweightKg * MAX_LOSS_FRACTION_PER_WEEK);
}

/** Fastest gain this app will prescribe for a given bodyweight, in kg/week. */
export function maxGainKgPerWeek(bodyweightKg: number): number {
  return Math.min(MAX_GAIN_KG_PER_WEEK, bodyweightKg * MAX_GAIN_FRACTION_PER_WEEK);
}

/**
 * Clamp a requested rate of bodyweight change into the safe band.
 * Negative is loss, positive is gain, matching `macroTargetSchema.basis`.
 */
export function clampRateKgPerWeek(
  requested: number,
  bodyweightKg: number,
): { rate: number; adjustment: SafetyAdjustment | null } {
  const rate = Math.min(
    maxGainKgPerWeek(bodyweightKg),
    Math.max(-maxLossKgPerWeek(bodyweightKg), requested),
  );
  return rate === requested
    ? { rate, adjustment: null }
    : { rate, adjustment: { code: 'rate_capped_to_safe_maximum', requested, applied: rate } };
}

/** BMI from canonical units. Present so the goal-weight guard has one definition. */
export function bmi(bodyweightKg: number, heightCm: number): number {
  const metres = heightCm / 100;
  return bodyweightKg / (metres * metres);
}

/** Bodyweight at a given BMI and height. The inverse, for the goal-weight floor. */
export function bodyweightAtBmi(targetBmi: number, heightCm: number): number {
  const metres = heightCm / 100;
  return targetBmi * metres * metres;
}

/**
 * Lowest goal bodyweight the app will accept.
 *
 * The app does not stop a user recording whatever they weigh, and it does not
 * comment on their current weight. It declines to help them *aim* below a
 * healthy BMI, which is a different act.
 */
export function clampGoalBodyweightKg(
  requestedKg: number,
  heightCm: number,
): { bodyweightKg: number; adjustment: SafetyAdjustment | null } {
  const floor = bodyweightAtBmi(MIN_HEALTHY_BMI, heightCm);
  if (requestedKg >= floor) return { bodyweightKg: requestedKg, adjustment: null };
  return {
    bodyweightKg: floor,
    adjustment: {
      code: 'goal_weight_raised_to_minimum_healthy_bmi',
      requested: requestedKg,
      applied: floor,
    },
  };
}

/**
 * The binding energy floor for one user: the higher of the population minimum
 * and their own BMR. Exported so the daily view can show the floor as a line on
 * the ring rather than only as a clamp the user never sees.
 */
export function energyFloorKcal(biologicalSex: BiologicalSex, bmrKcal: number): number {
  return Math.max(ABSOLUTE_FLOOR_KCAL[biologicalSex], bmrKcal * FLOOR_AT_FRACTION_OF_BMR);
}
