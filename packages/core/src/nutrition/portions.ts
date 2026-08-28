import { multiplyNutrients, roundTo, scaleNutrients, STORAGE_DECIMALS } from './nutrients.js';
import type { NutrientProfile, Serving } from './types.js';

/**
 * Portions, servings and unit conversion.
 *
 * This module is where nutrition apps go silently wrong, so it is deliberately
 * boring and exhaustively tested. Three invariants:
 *
 * 1. **Grams are canonical.** A volume is converted to a mass at log time using
 *    the food's density and the mass is what gets stored. A millilitre of olive
 *    oil is 0.91 g and 8.2 kcal; treating it as a gram understates a
 *    tablespoon of oil by 9%, every time, forever.
 *
 * 2. **A serving is a mass, not a string.** `"1 cup"` is a label. The number
 *    that matters is `gramsPerServing`, and it is the only thing arithmetic
 *    ever touches.
 *
 * 3. **Nothing here returns a formatted value.** These functions return
 *    canonical numbers. `format.ts` turns them into strings, one way, at the
 *    edge.
 */

/* ── Exact conversion factors ────────────────────────────────────────────────
 * All exact by definition, not rounded constants. `packages/data`'s units
 * module owns the mass/length factors for training load; these are the food and
 * volume ones, which it does not carry. The two never disagree because the
 * pound is derived from the same 1959 international definition.
 */

/** 1 lb = 0.45359237 kg exactly; an ounce is a sixteenth of that. */
export const GRAMS_PER_OUNCE = 28.349523125;
/** 1 lb, in grams. */
export const GRAMS_PER_POUND = 453.59237;
/** US customary fluid ounce. Not the imperial one, which is 28.4130625 ml. */
export const MILLILITRES_PER_US_FLUID_OUNCE = 29.5735295625;
/** US legal cup is 240 ml; this is the US customary cup that recipes mean. */
export const MILLILITRES_PER_US_CUP = 236.5882365;
export const MILLILITRES_PER_US_TABLESPOON = 14.78676478125;
export const MILLILITRES_PER_US_TEASPOON = 4.92892159375;

/**
 * Density assumed when a food is logged by volume and none is known.
 *
 * Matches `DEFAULT_DENSITY_G_PER_ML` in the datasets pipeline on purpose: if the
 * two differed, a food's serving mass would change depending on whether it came
 * from the index or from a user edit. Any serving derived with this assumption
 * must be surfaced as approximate — the index sets `flags.servingEstimated` for
 * exactly this reason.
 */
export const DEFAULT_DENSITY_G_PER_ML = 1.0;

/** Plausible density range for something a person eats or drinks. */
export const MIN_DENSITY_G_PER_ML = 0.1;
export const MAX_DENSITY_G_PER_ML = 5;

export function isPlausibleDensity(density: number): boolean {
  return (
    Number.isFinite(density) &&
    density >= MIN_DENSITY_G_PER_ML &&
    density <= MAX_DENSITY_G_PER_ML
  );
}

/**
 * A density we are willing to compute with. An implausible one is replaced by
 * the default rather than throwing: a bad density on one dataset row must not
 * be able to break the log screen.
 */
export function resolveDensity(density: number | null | undefined): number {
  return density != null && isPlausibleDensity(density) ? density : DEFAULT_DENSITY_G_PER_ML;
}

export function millilitresToGrams(millilitres: number, density?: number | null): number {
  return roundTo(millilitres * resolveDensity(density), STORAGE_DECIMALS);
}

export function gramsToMillilitres(grams: number, density?: number | null): number {
  return roundTo(grams / resolveDensity(density), STORAGE_DECIMALS);
}

export function ouncesToGrams(ounces: number): number {
  return roundTo(ounces * GRAMS_PER_OUNCE, STORAGE_DECIMALS);
}

export function gramsToOunces(grams: number): number {
  return roundTo(grams / GRAMS_PER_OUNCE, STORAGE_DECIMALS);
}

export function usFluidOuncesToMillilitres(flOz: number): number {
  return roundTo(flOz * MILLILITRES_PER_US_FLUID_OUNCE, STORAGE_DECIMALS);
}

export function millilitresToUsFluidOunces(millilitres: number): number {
  return roundTo(millilitres / MILLILITRES_PER_US_FLUID_OUNCE, STORAGE_DECIMALS);
}

/* ── Basis conversion ────────────────────────────────────────────────────── */

/**
 * The domain stores `nutrientsPer100g`, always. A volumetric dataset row states
 * its nutrients per 100 **ml**, so it has to be converted before it is stored.
 *
 * 100 ml of a food weighs `100 × density` grams, so 100 g of it occupies
 * `100 / density` ml and therefore carries `per100ml / density` nutrients.
 * For water (density 1) this is the identity, which is why the bug hides: it is
 * correct for the food people test with and wrong for oil, syrup and spirits.
 */
export function per100gFromPer100Ml(
  per100Ml: NutrientProfile,
  density?: number | null,
): NutrientProfile {
  const d = resolveDensity(density);
  return multiplyNutrients(per100Ml, 1 / d);
}

/** The inverse. Used to render a per-100 ml figure for a liquid the user logs by volume. */
export function per100MlFromPer100g(
  per100g: NutrientProfile,
  density?: number | null,
): NutrientProfile {
  const d = resolveDensity(density);
  return multiplyNutrients(per100g, d);
}

/**
 * Normalise a dataset row's nutrients to the canonical per-100 g form.
 *
 * @param basis `'g'` or `'ml'`, as the index reports it
 */
export function toCanonicalPer100g(
  per100: NutrientProfile,
  basis: 'g' | 'ml',
  density?: number | null,
): NutrientProfile {
  return basis === 'ml' ? per100gFromPer100Ml(per100, density) : per100;
}

/* ── Portions ────────────────────────────────────────────────────────────── */

/**
 * Mass of `quantity` servings. The one place a portion becomes a number.
 *
 * Rejects a negative quantity rather than clamping: a negative portion is
 * always a caller bug, and silently turning it into zero hides it behind a
 * plausible-looking log entry.
 */
export function gramsForPortion(quantity: number, serving: Serving): number {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new RangeError(`quantity must be a finite, non-negative number, got ${quantity}`);
  }
  if (!Number.isFinite(serving.gramsPerServing) || serving.gramsPerServing <= 0) {
    throw new RangeError(
      `serving.gramsPerServing must be positive, got ${serving.gramsPerServing}`,
    );
  }
  return roundTo(quantity * serving.gramsPerServing, STORAGE_DECIMALS);
}

/** Volume of `quantity` servings, for a serving that was defined by volume. */
export function millilitresForPortion(quantity: number, serving: Serving): number | undefined {
  if (serving.millilitresPerServing === undefined) return undefined;
  return roundTo(quantity * serving.millilitresPerServing, STORAGE_DECIMALS);
}

/** What a log entry needs to know, once a food and a portion have been chosen. */
export interface PortionNutrition {
  /** The canonical amount eaten. What day totals are ultimately built from. */
  massG: number;
  /** Present only when the portion was expressed by volume. Display support. */
  millilitresMl: number | undefined;
  /** Absolute nutrients for this portion — already multiplied out. */
  nutrients: NutrientProfile;
}

/**
 * Resolve a chosen portion into the numbers a log entry stores.
 *
 * `nutrientsPer100g` must already be canonical — pass a volumetric row through
 * `toCanonicalPer100g` first. Taking a per-100 ml profile here and scaling it by
 * a gram mass is precisely the silent error this module exists to prevent, so
 * the parameter is named for the unit it demands.
 */
export function computePortionNutrition(input: {
  nutrientsPer100g: NutrientProfile;
  quantity: number;
  serving: Serving;
}): PortionNutrition {
  const massG = gramsForPortion(input.quantity, input.serving);
  return {
    massG,
    millilitresMl: millilitresForPortion(input.quantity, input.serving),
    nutrients: scaleNutrients(input.nutrientsPer100g, massG),
  };
}

/**
 * Re-resolve an entry when the user changes only the quantity.
 *
 * Goes back through the per-100 g profile rather than scaling the previous
 * absolute numbers. Rescaling already-rounded values compounds the rounding on
 * every edit, and a user who taps `+` twelve times must land on exactly the
 * number they would have got by typing 12.
 */
export function rescalePortion(
  nutrientsPer100g: NutrientProfile,
  serving: Serving,
  nextQuantity: number,
): PortionNutrition {
  return computePortionNutrition({ nutrientsPer100g, quantity: nextQuantity, serving });
}

/**
 * Quantity that yields a given mass with the chosen serving. Used when the user
 * switches serving — "2 slices" (56 g) becomes "56 g", not "2 g".
 */
export function quantityForGrams(grams: number, serving: Serving): number {
  if (!Number.isFinite(serving.gramsPerServing) || serving.gramsPerServing <= 0) {
    throw new RangeError(
      `serving.gramsPerServing must be positive, got ${serving.gramsPerServing}`,
    );
  }
  return roundTo(grams / serving.gramsPerServing, STORAGE_DECIMALS);
}

/**
 * Switch serving while holding the mass constant.
 *
 * The behaviour a user expects and almost never gets: picking a different unit
 * changes how the amount is *expressed*, not how much they ate.
 */
export function convertQuantityBetweenServings(
  quantity: number,
  from: Serving,
  to: Serving,
): number {
  return quantityForGrams(gramsForPortion(quantity, from), to);
}

/* ── Standard servings ───────────────────────────────────────────────────── */

export const GRAM_SERVING: Serving = { name: 'g', gramsPerServing: 1 };
export const HUNDRED_GRAM_SERVING: Serving = { name: '100 g', gramsPerServing: 100 };
export const OUNCE_SERVING: Serving = { name: 'oz', gramsPerServing: GRAMS_PER_OUNCE };

export function millilitreServing(density?: number | null): Serving {
  return {
    name: 'ml',
    gramsPerServing: millilitresToGrams(1, density),
    millilitresPerServing: 1,
  };
}

export function usFluidOunceServing(density?: number | null): Serving {
  return {
    name: 'fl oz',
    gramsPerServing: millilitresToGrams(MILLILITRES_PER_US_FLUID_OUNCE, density),
    millilitresPerServing: MILLILITRES_PER_US_FLUID_OUNCE,
  };
}

export function usCupServing(density?: number | null): Serving {
  return {
    name: 'cup',
    gramsPerServing: millilitresToGrams(MILLILITRES_PER_US_CUP, density),
    millilitresPerServing: MILLILITRES_PER_US_CUP,
  };
}

/**
 * The serving list offered for a food, most useful first.
 *
 * The food's own stated serving leads, because "1 slice" is what the user is
 * holding. Volumetric units appear only for a liquid — offering "cup" for
 * chicken breast is noise, and noise costs a tap.
 */
export function servingsForFood(input: {
  statedServingGrams?: number | null;
  statedServingLabel?: string | null;
  basis: 'g' | 'ml';
  densityGPerMl?: number | null;
  /** Adds `oz`/`fl oz`. Follows the user's mass display preference, not their locale. */
  imperial?: boolean;
}): Serving[] {
  const servings: Serving[] = [];
  const isLiquid = input.basis === 'ml' || input.densityGPerMl != null;

  if (input.statedServingGrams != null && input.statedServingGrams > 0) {
    const label = input.statedServingLabel?.trim();
    servings.push({
      name: label && label.length > 0 ? label : 'serving',
      gramsPerServing: input.statedServingGrams,
      ...(isLiquid
        ? { millilitresPerServing: gramsToMillilitres(input.statedServingGrams, input.densityGPerMl) }
        : {}),
    });
  }

  servings.push(GRAM_SERVING, HUNDRED_GRAM_SERVING);
  if (isLiquid) servings.push(millilitreServing(input.densityGPerMl));
  if (input.imperial === true) {
    servings.push(OUNCE_SERVING);
    if (isLiquid) servings.push(usFluidOunceServing(input.densityGPerMl), usCupServing(input.densityGPerMl));
  }

  // A stated serving of exactly 1 g or 100 g would otherwise appear twice.
  const seen = new Set<string>();
  return servings.filter((s) => {
    const key = `${s.name}:${s.gramsPerServing}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The serving a food should open on.
 *
 * Its own stated serving if it has one, because that is the number on the
 * packet; otherwise 100 g, which is the unit the data is already in and so the
 * one where the displayed nutrients need no mental arithmetic.
 */
export function defaultServing(servings: readonly Serving[]): Serving {
  return servings[0] ?? HUNDRED_GRAM_SERVING;
}
