/**
 * Nutrient normalisation: everything becomes per-100 g (or per-100 ml).
 *
 * The two upstreams disagree about basis in opposite directions, and getting
 * this wrong is the failure mode users notice: a 4x error in a logged meal.
 *
 *   USDA Foundation / SR Legacy : already per 100 g.
 *   USDA Branded                : `foodNutrients` per 100 g, `labelNutrients`
 *                                 per *serving*. We prefer the per-100 g array
 *                                 and only fall back to converting the label.
 *   Open Food Facts             : `nutriments` carries both `_100g` and
 *                                 `_serving`. We take `_100g` and never the
 *                                 `_serving` variant.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ATWATER_TOLERANCE,
  DEFAULT_DENSITY_G_PER_ML,
  SANITY,
} from '../../src/schema.mjs';

/** @typedef {{kcal:number, proteinG:number, carbG:number, fatG:number, fibreG:number, sugarG:number, sodiumMg:number, satFatG:number}} Nutrients */

export const EMPTY_NUTRIENTS = /** @type {Nutrients} */ ({
  kcal: 0,
  proteinG: 0,
  carbG: 0,
  fatG: 0,
  fibreG: 0,
  sugarG: 0,
  sodiumMg: 0,
  satFatG: 0,
});

/**
 * Rescale a nutrient set measured over `grams` to a per-100 g basis.
 * @param {Nutrients} n @param {number} grams
 * @returns {Nutrients}
 */
export function toPer100(n, grams) {
  if (!(grams > 0)) throw new RangeError(`cannot rescale from ${grams} g`);
  const f = 100 / grams;
  return {
    kcal: n.kcal * f,
    proteinG: n.proteinG * f,
    carbG: n.carbG * f,
    fatG: n.fatG * f,
    fibreG: n.fibreG * f,
    sugarG: n.sugarG * f,
    sodiumMg: n.sodiumMg * f,
    satFatG: n.satFatG * f,
  };
}

/**
 * Energy implied by the macros, using the general Atwater factors
 * (4/4/9 kcal per g, 2 kcal/g for fibre, which is the EU convention and close
 * enough for a cross-check).
 * @param {Nutrients} n
 */
export function atwaterKcal(n) {
  const netCarb = Math.max(0, n.carbG - n.fibreG);
  return 4 * n.proteinG + 4 * netCarb + 9 * n.fatG + 2 * n.fibreG;
}

/**
 * Fill in energy from the macros when upstream did not state it.
 *
 * A surprising share of USDA records carry protein, fat and carbohydrate but no
 * energy field — 137 of 500 in the sample. Shipping those as written means a
 * user logs tinned anchovies and sees 0 kcal, which is worse than not finding
 * the food. The Atwater estimate for that record is 206 kcal against USDA's
 * published 210, so the computed value is far closer to the truth than zero is.
 *
 * It also fires on a stated zero that the macros contradict. Open Food Facts
 * contributors regularly fill in the macros and leave energy at 0, and a food
 * with 27 g of protein is not a zero-calorie food whatever the field says. This
 * cannot misfire on a genuine zero-calorie food: diet soda and black coffee
 * have zero macros, so the Atwater estimate is zero and nothing changes.
 *
 * It also fires on a stated energy too small for the kcal column to hold.
 * Open Food Facts has `energy-kcal_100g: 0.038` for a Mooala oat milk — a
 * contributor typed the per-serving figure into a per-serving field OFF then
 * divided again. The old guard was `n.kcal > 0`, and 0.038 satisfies it, so the
 * value passed through untouched and `quantise` rounded it to **zero**: oat
 * milk shipped with no calories, which is the exact failure this function
 * exists to prevent, arriving through the one door it left open. Rounding to
 * zero is the test, not being zero.
 *
 * @param {Nutrients} n
 * @returns {{n:Nutrients, derived:boolean}}
 */
export function fillEnergy(n) {
  // The kcal column is integers, so anything under 0.5 stores as 0.
  if (Math.round(n.kcal) > 0) return { n, derived: false };
  const est = atwaterKcal(n);
  if (!(est > 0)) return { n, derived: false };
  return { n: { ...n, kcal: est }, derived: true };
}

/**
 * Decide whether a record is usable, and whether its stated energy is credible.
 *
 * We do not silently repair a mismatch by substituting the Atwater estimate.
 * Sugar alcohols, alcohol, and unusual fibre all produce legitimate mismatches,
 * so an automatic "fix" would corrupt correct records to make a report look
 * tidy. We flag instead, and the app can surface the uncertainty.
 *
 * @param {Nutrients} n
 * @param {{energyReported?:boolean}} [ctx]
 *        Whether upstream stated an energy value at all. A record with no
 *        energy field and no macros is missing data; a record that explicitly
 *        states 0 kcal is a diet soda. They are identical in the numbers.
 * @returns {{ok:true, atwaterMismatch:boolean} | {ok:false, reason:string}}
 */
export function validate(n, ctx = {}) {
  for (const [k, v] of Object.entries(n)) {
    if (!Number.isFinite(v) || v < 0) return { ok: false, reason: `${k} is ${v}` };
  }
  if (n.kcal > SANITY.maxKcalPer100g) return { ok: false, reason: `kcal ${n.kcal} > 100 g of fat` };
  if (n.proteinG > SANITY.maxMacroG || n.carbG > SANITY.maxMacroG || n.fatG > SANITY.maxMacroG) {
    return { ok: false, reason: 'a macro exceeds 100 g per 100 g' };
  }
  if (n.proteinG + n.carbG + n.fatG > 100 + 5) {
    return { ok: false, reason: 'macros sum above 100 g per 100 g' };
  }
  if (n.sodiumMg > SANITY.maxSodiumMg) return { ok: false, reason: `sodium ${n.sodiumMg} mg` };
  if (n.satFatG > n.fatG + 0.5) return { ok: false, reason: 'saturated fat exceeds total fat' };

  const noMacros = n.proteinG === 0 && n.carbG === 0 && n.fatG === 0;
  if (n.kcal === 0 && noMacros && !ctx.energyReported) {
    // No energy field and no macros: upstream simply has not filled this
    // record in. Shipping it means a user logs a food and sees 0 kcal, which is
    // worse than not finding the food at all.
    return { ok: false, reason: 'no energy or macro data reported' };
  }
  if (Object.values(n).every((v) => v === 0) && !ctx.energyReported) {
    return { ok: false, reason: 'no nutrient data' };
  }

  const est = atwaterKcal(n);
  const ref = Math.max(n.kcal, est, 1);
  return { ok: true, atwaterMismatch: Math.abs(n.kcal - est) / ref > ATWATER_TOLERANCE };
}

/**
 * Quantise to the storage precision declared in the schema, and clamp to the
 * column width. Encoding must round-trip through this function so that a
 * verification pass compares like with like.
 * @param {Nutrients} n
 * @returns {Nutrients}
 */
export function quantise(n) {
  return {
    kcal: clampInt(Math.round(n.kcal), 0xffff),
    proteinG: clampInt(Math.round(n.proteinG * 100), 0xffff) / 100,
    carbG: clampInt(Math.round(n.carbG * 100), 0xffff) / 100,
    fatG: clampInt(Math.round(n.fatG * 100), 0xffff) / 100,
    fibreG: clampInt(Math.round(n.fibreG * 100), 0xffff) / 100,
    sugarG: clampInt(Math.round(n.sugarG * 100), 0xffff) / 100,
    sodiumMg: clampInt(Math.round(n.sodiumMg), 0xffff),
    satFatG: clampInt(Math.round(n.satFatG * 2), 0xff) / 2,
  };
}

/** @param {number} v @param {number} max */
function clampInt(v, max) {
  return Math.max(0, Math.min(max, v | 0));
}

const UNIT_TO_GRAMS = {
  g: 1,
  gram: 1,
  grams: 1,
  mg: 0.001,
  kg: 1000,
  oz: 28.349523125,
  ounce: 28.349523125,
  ounces: 28.349523125,
  lb: 453.59237,
};

const UNIT_TO_ML = { ml: 1, milliliter: 1, millilitre: 1, l: 1000, cl: 10, dl: 100, 'fl oz': 29.5735 };

/**
 * Parse a free-text serving size into grams.
 *
 * Returns `estimated: true` when the stated unit was a volume and we applied
 * DEFAULT_DENSITY_G_PER_ML. That flag reaches the client, which is the point:
 * "240 g (estimated)" for a cup of oil is honest, and silently claiming 240 g is
 * not.
 *
 * @param {string|number|null|undefined} raw
 * @returns {{grams:number, estimated:boolean, basis:'g'|'ml'}|null}
 */
export function parseServing(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? { grams: raw, estimated: false, basis: 'g' } : null;
  }
  const s = raw.toLowerCase().replace(/,/g, '.');
  const m = s.match(/(\d+(?:\.\d+)?)\s*(fl oz|[a-z]+)/);
  if (!m) return null;
  const qty = Number(m[1]);
  const unit = m[2] ?? '';
  if (!Number.isFinite(qty) || qty <= 0) return null;

  const g = UNIT_TO_GRAMS[/** @type {keyof typeof UNIT_TO_GRAMS} */ (unit)];
  if (g) return { grams: qty * g, estimated: false, basis: 'g' };

  const ml = UNIT_TO_ML[/** @type {keyof typeof UNIT_TO_ML} */ (unit)];
  if (ml) {
    return { grams: qty * ml * DEFAULT_DENSITY_G_PER_ML, estimated: true, basis: 'ml' };
  }
  return null;
}

/**
 * UN/CEFACT Recommendation 20 unit codes, as they appear in USDA's
 * `householdServingFullText` and in Open Food Facts' `serving_size`.
 *
 * These are machine codes that reached the user's screen. 6,732 shipped records
 * — 7.1% of every record carrying a label — rendered one, and not with the
 * tidy leading "1" the bug was first reported as:
 *
 *     "10.05 ONZ" (285 g)   ->  picker read "1 serving — 10.05 onz (285 g)"
 *     "0.21 ONZ"  (6 g)     ->  "0.21 onz"
 *     "30 GRM"    (30 g)    ->  "30 grm"
 *
 * It cannot be fixed at the display layer: stripping a leading count works only
 * when the count is 1, and keeping a non-one count is what stops "2 tbsp" being
 * silently reduced to "tbsp" and halving a logged amount. So it is a
 * data-cleaning problem and it belongs here.
 */
const UNIT_CODE = {
  ONZ: 'oz',
  // OZA is the US FLUID ounce, not the mass ounce, and the data says so
  // unambiguously: median 30.0 g per OZA across 2,053 records, and the records
  // are drinks — "8 OZA" -> 240 g, "12 OZA" -> 355 g (a standard can),
  // "6.76 OZA" -> 200 g. Mapping it to "oz" would have been a 5% error and,
  // worse, would have called a volume a mass.
  OZA: 'fl oz',
  LBR: 'lb',
  GRM: 'g',
  KGM: 'kg',
  MGM: 'mg',
  MLT: 'ml',
  LTR: 'l',
  DLT: 'dl',
  CLT: 'cl',
  // "each" is the code's literal meaning and reads badly on a portion sheet;
  // "item" is the same fact in a word someone would say. Two records.
  EA: 'item',
};

/**
 * Household measure text, cleaned for display ("1 cup (240 ml)" -> "1 cup").
 * Kept short: it renders inside a 48px row on a phone.
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
export function servingLabel(raw) {
  if (!raw) return null;
  const s = String(raw)
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // Whole-word only, so a product named "ONZA" or a unit "GRMS" is untouched.
    // Case-insensitive because 11 records already carry a lowercased "1 onz";
    // a word that is not a code (cup, tbsp, oz) simply misses the table.
    .replace(
      /\b([A-Za-z]{2,3})\b/g,
      (m) => UNIT_CODE[/** @type {keyof typeof UNIT_CODE} */ (m.toUpperCase())] ?? m,
    )
    .trim();
  if (!s || s.length > 32) return null;
  return s;
}
