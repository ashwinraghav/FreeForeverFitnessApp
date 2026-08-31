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
/**
 * Kept for the entries that already carry it — `servingsForFood` no longer
 * offers it. See the note there on why a serving named for a quantity turns the
 * amount field into a multiplier.
 */
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
 * The name given to a stated serving whose label says nothing usable.
 *
 * "serving" and not "portion" or "unit": it is the word the packet itself uses,
 * and the picker reads `1 serving (31 g)` without inventing a unit the label
 * never claimed.
 */
export const GENERIC_SERVING_NAME = 'serving';

/**
 * The units this module offers for every food, as opposed to the one the packet
 * states. Nothing else may be named these — `normaliseStatedServingName` folds
 * a colliding packet label onto the same name on purpose, and
 * `servingsForFood` then drops our generic duplicate in favour of the packet's.
 */
const GENERIC_SERVING_NAMES = new Set(['g', '100 g', 'ml', '100 ml', 'oz', 'fl oz', 'cup']);

/**
 * The two names a serving list can start with when the food states no serving
 * of its own. Position zero is therefore enough to tell a stated serving from a
 * fallback, with no extra field to persist and no name-sniffing.
 */
const FALLBACK_LEAD_NAMES = new Set(['g', 'ml']);

/**
 * A label that is nothing but the mass, which the index already gives us as a
 * number: Open Food Facts is full of `"33g"`, `"36 g"` and `"177.441g"`.
 *
 * Passing one of those through as a serving *name* produces `1 serving — 33g
 * (33 g)` in the picker and an amount field reading `1 · 33g`, which is worse
 * than saying nothing. There is no wording here to keep, so there is none kept.
 */
const MASS_ONLY_LABEL =
  /^[\d.,]+\s*(?:g|gram|grams|kg|mg|ml|l|litre|liter|oz|fl\s?oz)\.?$/i;

/** A parenthetical that only restates the mass we already hold: "1 scoop (31 g)". */
const RESTATED_MASS =
  /\s*\((?:about\s+|approx\.?\s*|~)?[\d.,]+\s*(?:g|gram|grams|kg|ml|l|litre|liter|oz|fl\s?oz)\.?\)\s*$/i;

/** "1 scoop", "one bar" — a count of exactly one, so the rest is the unit. */
const LEADING_ONE = /^(?:1|one)\s+(.+)$/i;

/** Any other leading count, including vulgar fractions: "2 tbsp", "½ cup". */
const LEADING_COUNT = /^[\d\u00BC-\u00BE\u2150-\u215E]/;

/** `Serving.name` is a display name upstream (`displayNameSchema`): 1..120 chars. */
const MAX_SERVING_NAME = 120;

/**
 * Turn what a packet says into a `Serving.name`.
 *
 * The datasets give this to us three ways and all three arrive: USDA's
 * `householdServingFullText` ("1 Scoop"), Open Food Facts' `serving_size`
 * ("1 scoop (31 g)"), and nothing at all.
 *
 * The rule that matters is the count. `"1 scoop"` reduces to the unit `scoop`,
 * so the amount field reads `2 scoop` and means two scoops. `"2 tbsp"` does
 * **not** reduce — one serving *is* two tablespoons, and naming the serving
 * `tbsp` would make every logged amount half of what the packet says. So a
 * label with any count other than one is kept whole and used as the name.
 */
export function normaliseStatedServingName(rawLabel: string | null | undefined): string {
  const cleaned = (rawLabel ?? '')
    .replace(RESTATED_MASS, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '' || MASS_ONLY_LABEL.test(cleaned)) return GENERIC_SERVING_NAME;

  const one = LEADING_ONE.exec(cleaned);
  const unit = one?.[1] ?? (LEADING_COUNT.test(cleaned) ? cleaned : cleaned);
  // Units are lowercase in English, and USDA shouts them ("1 Scoop", "1 CUP").
  // A packet label is never a proper noun, so folding case loses nothing.
  const name = unit.toLowerCase().slice(0, MAX_SERVING_NAME).trim();
  return name === '' ? GENERIC_SERVING_NAME : name;
}

/**
 * The serving list offered for a food, most useful first.
 *
 * Order is the whole point of this function, because position zero is what the
 * sheet opens on:
 *
 *   1. The food's own stated serving. Logging a scoop of whey is the common
 *      case; logging exactly 100 g of whey is not a thing anyone does.
 *   2. A raw gram entry — or millilitres first, for a liquid.
 *   3. Imperial units, on request.
 *
 * **There is no `100 g` row, and its absence is deliberate.** A serving *named*
 * for a quantity forces the amount beside it to be a multiplier: the field
 * reads `1 × 100 g`, and logging 150 g means typing `1.5`. That is the shape
 * the user was complaining about. `defaultPortion` opens a food with no stated
 * serving on **100 grams** instead — the same number, in a field that reads
 * `100 g` and steps in fives.
 *
 * Volumetric units appear only for a liquid: offering "cup" for chicken breast
 * is noise, and noise costs a tap.
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
  const density = input.densityGPerMl;

  const statedGrams = input.statedServingGrams;
  const stated =
    statedGrams != null && statedGrams > 0
      ? ({
          name: normaliseStatedServingName(input.statedServingLabel),
          gramsPerServing: statedGrams,
          ...(isLiquid ? { millilitresPerServing: gramsToMillilitres(statedGrams, density) } : {}),
        } satisfies Serving)
      : null;
  if (stated) servings.push(stated);

  // A drink is measured in millilitres and weighed only by accident, so volume
  // leads for a liquid. Grams stay in the list either way, for a scale.
  if (isLiquid) servings.push(millilitreServing(density));
  servings.push(GRAM_SERVING);
  if (input.imperial === true) {
    servings.push(OUNCE_SERVING);
    if (isLiquid) servings.push(usFluidOunceServing(density), usCupServing(density));
  }

  // Two collapses, both about not offering the same thing twice:
  //  - an identical name *and* mass (a stated serving of exactly 1 g);
  //  - a generic unit whose name the packet already claimed ("1 cup" stated at
  //    240 g would otherwise sit beside our computed 243.7 g cup, both reading
  //    "cup" and differing only in the small print).
  const claimedByPacket =
    stated !== null && GENERIC_SERVING_NAMES.has(stated.name) ? stated.name : null;
  const seen = new Set<string>();
  return servings.filter((s, index) => {
    if (claimedByPacket !== null && index > 0 && s.name === claimedByPacket) return false;
    const key = `${s.name}:${s.gramsPerServing}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The serving a food should open on: its own, if it has one.
 *
 * Pair it with `defaultPortion` rather than assuming a quantity of 1 — for a
 * food with no stated serving the opening amount is 100 grams, not one gram.
 */
export function defaultServing(servings: readonly Serving[]): Serving {
  return servings[0] ?? GRAM_SERVING;
}

/**
 * The amount a food should open on.
 *
 * One serving where the packet states one, because "select Optimum Nutrition,
 * select one serving" is the whole interaction and it should cost no taps.
 * Otherwise 100 g (or 100 ml), which is the unit the data is already in and so
 * the one where the displayed nutrients need no mental arithmetic.
 *
 * It used to be one *gram*, because grams led the serving list and the quantity
 * was hard-coded to 1. Opening a chicken breast on `1 g` is not a rounding
 * error, it is a wrong screen.
 */
export function defaultPortion(servings: readonly Serving[]): {
  serving: Serving;
  quantity: number;
} {
  return {
    serving: defaultServing(servings),
    quantity: hasStatedServing(servings) ? 1 : 100,
  };
}

/**
 * Whether the first serving in a list is the food's own, rather than a fallback
 * this module offers for everything.
 *
 * Derived from position rather than from a flag on `Serving`, because `Serving`
 * is persisted against every log entry and its schema upstream is a
 * `strictObject` — a display-only flag has no business in a user's history.
 * `servingsForFood` leads with `100 g`/`100 ml` exactly when there is no stated
 * serving, so position zero answers the question exactly.
 *
 * The honest answer matters: a food with no stated serving must not be shown a
 * "1 serving" option that quietly means 100 g. For anything dense — oil, whey,
 * peanut butter — that is a threefold logging error, not a rounding one.
 */
export function hasStatedServing(servings: readonly Serving[]): boolean {
  const first = servings[0];
  return first !== undefined && !FALLBACK_LEAD_NAMES.has(first.name);
}

/**
 * True when a stated serving name already spells out its own count — "2 tbsp",
 * "½ cup". `normaliseStatedServingName` strips a count of *one* and nothing
 * else, so anything still leading with a digit is the packet saying that one
 * serving is more (or less) than one of something.
 */
export function servingNameCarriesCount(name: string): boolean {
  return LEADING_COUNT.test(name);
}
