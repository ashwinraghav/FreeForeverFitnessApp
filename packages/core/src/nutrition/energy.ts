import { roundTo } from './nutrients.js';
import {
  MAX_VALIDATED_AGE_YEARS,
  MIN_VALIDATED_AGE_YEARS,
  type SafetyAdjustment,
} from './safety.js';
import type { ActivityLevel, BiologicalSex } from './types.js';

/**
 * Energy expenditure.
 *
 * Deterministic, offline, and free — which is the whole argument. The paid
 * competitors charge for a number that is one multiplication away from three
 * facts the user already told us. There is no model here and there is no
 * request; there is a 1990 regression equation and an activity multiplier.
 */

/**
 * Mifflin-St Jeor coefficients. The sex term is the only place the equation
 * differs, which is why `unspecified` can take the midpoint and still produce a
 * defensible number rather than refusing to produce one.
 */
const SEX_CONSTANT: Readonly<Record<BiologicalSex, number>> = {
  male: 5,
  female: -161,
  /** Midpoint of the two. Documented in `packages/data`'s profile schema. */
  unspecified: -78,
};

/**
 * Activity multipliers applied to BMR to reach total daily expenditure.
 *
 * The conventional Harris-Benedict ladder. They are coarse and everybody knows
 * it: the point of a starting estimate is to be adjusted against real weight
 * data after a fortnight, which is what `insights` is for. An estimate the user
 * can correct beats a precise-looking one they cannot.
 */
export const ACTIVITY_MULTIPLIERS: Readonly<Record<ActivityLevel, number>> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
  extremely_active: 1.9,
};

export interface BmrInput {
  bodyweightKg: number;
  heightCm: number;
  ageYears: number;
  biologicalSex: BiologicalSex;
}

/**
 * Basal metabolic rate, Mifflin-St Jeor (1990).
 *
 *   BMR = 10·kg + 6.25·cm − 5·age + s
 *
 * Chosen over Harris-Benedict because it is the more accurate of the two in
 * modern populations, and over Katch-McArdle because that one needs a body-fat
 * percentage most users do not have and would have to guess — and a guessed
 * input in a more precise equation is a worse estimate, not a better one.
 *
 * Returns an unclamped, unrounded number. Safety floors are applied where a
 * *target* is produced, not here: BMR is a measurement estimate and clamping it
 * would corrupt the floor that is derived from it.
 */
export function mifflinStJeorBmr(input: BmrInput): number {
  const { bodyweightKg, heightCm, ageYears, biologicalSex } = input;
  if (!Number.isFinite(bodyweightKg) || bodyweightKg <= 0) {
    throw new RangeError(`bodyweightKg must be positive, got ${bodyweightKg}`);
  }
  if (!Number.isFinite(heightCm) || heightCm <= 0) {
    throw new RangeError(`heightCm must be positive, got ${heightCm}`);
  }
  if (!Number.isFinite(ageYears) || ageYears < 0) {
    throw new RangeError(`ageYears must be non-negative, got ${ageYears}`);
  }
  return 10 * bodyweightKg + 6.25 * heightCm - 5 * ageYears + SEX_CONSTANT[biologicalSex];
}

/**
 * Age used in the equation, plus a flag when the real age is outside the band
 * Mifflin-St Jeor was validated in.
 *
 * The age is clamped rather than the calculation refused, and the clamp is
 * reported so the UI can say the estimate is less reliable. Silently
 * extrapolating to a 14-year-old is the failure this prevents: energy
 * prescription for a minor is a genuinely different clinical question, and the
 * app must not pretend otherwise.
 */
export function validateAge(ageYears: number): {
  ageYears: number;
  adjustment: SafetyAdjustment | null;
} {
  const clamped = Math.min(MAX_VALIDATED_AGE_YEARS, Math.max(MIN_VALIDATED_AGE_YEARS, ageYears));
  return clamped === ageYears
    ? { ageYears, adjustment: null }
    : {
        ageYears: clamped,
        adjustment: {
          code: 'age_outside_validated_range',
          requested: ageYears,
          applied: clamped,
        },
      };
}

/** Total daily energy expenditure: BMR scaled by an activity multiplier. */
export function tdeeKcal(bmrKcal: number, activityLevel: ActivityLevel): number {
  return bmrKcal * ACTIVITY_MULTIPLIERS[activityLevel];
}

/**
 * Whole pipeline from profile facts to maintenance energy.
 *
 * Rounded to the nearest kilocalorie at the boundary only — intermediate values
 * stay full precision so the result does not depend on how many steps it took.
 */
export function estimateMaintenanceKcal(
  input: BmrInput & { activityLevel: ActivityLevel },
): { bmrKcal: number; tdeeKcal: number; adjustments: SafetyAdjustment[] } {
  const age = validateAge(input.ageYears);
  const bmr = mifflinStJeorBmr({ ...input, ageYears: age.ageYears });
  return {
    bmrKcal: roundTo(bmr, 0),
    tdeeKcal: roundTo(tdeeKcal(bmr, input.activityLevel), 0),
    adjustments: age.adjustment ? [age.adjustment] : [],
  };
}

/**
 * Daily energy delta implied by a rate of bodyweight change.
 * Negative rate (loss) gives a negative delta.
 */
export function dailyEnergyDeltaForRate(rateKgPerWeek: number, kcalPerKg: number): number {
  return (rateKgPerWeek * kcalPerKg) / 7;
}
