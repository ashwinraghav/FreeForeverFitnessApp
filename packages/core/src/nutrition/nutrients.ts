import {
  KCAL_PER_GRAM,
  NUTRIENT_FIELDS,
  OPTIONAL_NUTRIENT_FIELDS,
  REQUIRED_NUTRIENT_FIELDS,
  type NutrientProfile,
  type OptionalNutrientField,
} from './types.js';

/**
 * Nutrient arithmetic.
 *
 * Two rules, and every function here exists to hold one of them.
 *
 * **Absent is not zero.** A dataset row without a fibre figure is not a food
 * with no fibre. Optional fields propagate as "unknown" through scaling and
 * summing: a total carries a fibre number only when at least one contributing
 * entry actually had one. Collapsing that distinction is how a nutrition app
 * ends up telling a user they ate 0 g of fibre on a day of lentils.
 *
 * **A stored number is canonical and unrounded-for-display.** Everything here
 * returns grams, millgrams and kilocalories. Rounding happens once, at the
 * storage boundary, to `STORAGE_DECIMALS` — enough that float noise never
 * reaches a document, fine enough that summing 150 entries stays exact to well
 * under a tenth of a kilocalorie. Display rounding lives in `format.ts` and its
 * output never travels back into a document.
 */

/**
 * Decimal places a canonical value is rounded to before storage.
 *
 * Four, not two. Two decimal places on a per-entry gram value accumulates up to
 * 0.005 g of error per entry, which is 0.75 g across the 150-entry day cap —
 * visible on a fibre total. Four places bounds the same worst case at 0.0075 g.
 */
export const STORAGE_DECIMALS = 4;

/** Round half away from zero, at a fixed decimal place, without float artefacts. */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  // `Number.EPSILON` scaling is the usual trick and is wrong for large values.
  // Going through the decimal string is exact for every magnitude this domain
  // produces and is not on a hot path — it runs once per stored field.
  const shifted = Number(`${value}e${decimals}`);
  const rounded = Math.sign(shifted) * Math.round(Math.abs(shifted));
  const result = Number(`${rounded}e${-decimals}`);
  return Object.is(result, -0) ? 0 : result;
}

/** Round every field to the storage resolution. Applied at the document boundary. */
export function toStorageResolution(profile: NutrientProfile): NutrientProfile {
  return mapProfile(profile, (value) => roundTo(value, STORAGE_DECIMALS));
}

/** A profile with the required fields at zero and every optional field absent. */
export function zeroNutrients(): NutrientProfile {
  return { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
}

/**
 * Apply `fn` to every present field. Absent optional fields stay absent, which
 * is why this cannot be a plain `Object.entries` map with a default.
 */
export function mapProfile(
  profile: NutrientProfile,
  fn: (value: number) => number,
): NutrientProfile {
  const out: NutrientProfile = {
    energyKcal: fn(profile.energyKcal),
    proteinG: fn(profile.proteinG),
    carbsG: fn(profile.carbsG),
    fatG: fn(profile.fatG),
  };
  for (const field of OPTIONAL_NUTRIENT_FIELDS) {
    const value = profile[field];
    if (value !== undefined) out[field] = fn(value);
  }
  return out;
}

/**
 * Scale a per-100 profile to an absolute amount.
 *
 * This is the single most consequential multiplication in the product — it is
 * what turns "chicken breast, 165 kcal/100 g" into the number a user acts on —
 * so it exists exactly once and everything else calls it.
 *
 * @param per100 nutrients per 100 g (or per 100 ml; see `portions.ts`)
 * @param amount grams, or millilitres when `per100` is volumetric
 */
export function scaleNutrients(per100: NutrientProfile, amount: number): NutrientProfile {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(`amount must be a finite, non-negative number, got ${amount}`);
  }
  const factor = amount / 100;
  return toStorageResolution(mapProfile(per100, (value) => value * factor));
}

/**
 * Multiply every present field by a factor.
 *
 * Distinct from `scaleNutrients`, which carries the per-100 semantics in its
 * name and its arithmetic. Use this when the profile is already absolute — a
 * recipe total divided into servings, a per-100 ml figure divided by a density.
 */
export function multiplyNutrients(profile: NutrientProfile, factor: number): NutrientProfile {
  if (!Number.isFinite(factor) || factor < 0) {
    throw new RangeError(`factor must be a finite, non-negative number, got ${factor}`);
  }
  return toStorageResolution(mapProfile(profile, (value) => value * factor));
}

/**
 * Sum profiles. Required fields always sum; an optional field appears in the
 * result only if at least one input carried it, and inputs that omitted it
 * contribute nothing rather than an assumed zero.
 *
 * The asymmetry is deliberate and is the reason this is not `reduce((a,b)=>…)`
 * over a fully populated record.
 */
export function addNutrients(...profiles: readonly NutrientProfile[]): NutrientProfile {
  const out = zeroNutrients();
  const seen = new Set<OptionalNutrientField>();

  for (const profile of profiles) {
    for (const field of REQUIRED_NUTRIENT_FIELDS) out[field] += profile[field];
    for (const field of OPTIONAL_NUTRIENT_FIELDS) {
      const value = profile[field];
      if (value === undefined) continue;
      out[field] = (out[field] ?? 0) + value;
      seen.add(field);
    }
  }

  // A field nobody carried must not materialise as 0.
  for (const field of OPTIONAL_NUTRIENT_FIELDS) if (!seen.has(field)) delete out[field];
  return toStorageResolution(out);
}

/**
 * Subtract `b` from `a`, clamping nothing. Used for "remaining today", where a
 * negative result is the point — a user over their protein target needs to see
 * by how much, not a floor of zero.
 */
export function subtractNutrients(a: NutrientProfile, b: NutrientProfile): NutrientProfile {
  const out: NutrientProfile = {
    energyKcal: a.energyKcal - b.energyKcal,
    proteinG: a.proteinG - b.proteinG,
    carbsG: a.carbsG - b.carbsG,
    fatG: a.fatG - b.fatG,
  };
  for (const field of OPTIONAL_NUTRIENT_FIELDS) {
    const left = a[field];
    const right = b[field];
    if (left === undefined && right === undefined) continue;
    out[field] = (left ?? 0) - (right ?? 0);
  }
  return toStorageResolution(out);
}

/**
 * Energy implied by the macros, via the Atwater general factors.
 *
 * Alcohol is included because a drink logged with only `alcoholG` otherwise
 * appears to have calories from nowhere, and the discrepancy gets blamed on the
 * app rather than on ethanol.
 */
export function energyFromMacros(profile: NutrientProfile): number {
  const alcohol = profile.alcoholG ?? 0;
  return roundTo(
    profile.proteinG * KCAL_PER_GRAM.protein +
      profile.carbsG * KCAL_PER_GRAM.carb +
      profile.fatG * KCAL_PER_GRAM.fat +
      alcohol * KCAL_PER_GRAM.alcohol,
    STORAGE_DECIMALS,
  );
}

/**
 * Relative disagreement between stated energy and the energy its macros imply.
 *
 * The datasets pipeline already flags this upstream as `atwaterMismatch` at a
 * 25% threshold; this recomputes it for user-authored foods and recipes, which
 * never went through that pipeline. Returns 0 when there is no stated energy to
 * disagree with.
 */
export function atwaterDiscrepancy(profile: NutrientProfile): number {
  const implied = energyFromMacros(profile);
  if (profile.energyKcal <= 0) return implied > 0 ? 1 : 0;
  return Math.abs(implied - profile.energyKcal) / profile.energyKcal;
}

/** Matches the datasets pipeline's threshold so the two never disagree on a food. */
export const ATWATER_MISMATCH_THRESHOLD = 0.25;

export function hasAtwaterMismatch(profile: NutrientProfile): boolean {
  return atwaterDiscrepancy(profile) > ATWATER_MISMATCH_THRESHOLD;
}

/**
 * Fraction of `energyKcal` contributed by each macro. Used by the daily view's
 * split bar. Returns nulls rather than NaN for a zero-energy food — a diet soda
 * has no macro split, and `0/0` rendered as "NaN%" is a bug users report.
 */
export function macroEnergyShare(
  profile: NutrientProfile,
): { protein: number; carbs: number; fat: number } | null {
  const total = energyFromMacros(profile);
  if (total <= 0) return null;
  return {
    protein: (profile.proteinG * KCAL_PER_GRAM.protein) / total,
    carbs: (profile.carbsG * KCAL_PER_GRAM.carb) / total,
    fat: (profile.fatG * KCAL_PER_GRAM.fat) / total,
  };
}

/** Every field name, for iteration in tests and in the micronutrient breakdown. */
export { NUTRIENT_FIELDS };
