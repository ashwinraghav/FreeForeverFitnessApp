/**
 * USDA FoodData Central source adapter.
 *
 * Licence: public domain (17 U.S.C. § 105). No conditions. See NOTICE.md §1.
 * Everything this adapter emits lands in the `core` shard.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { SOURCE } from '../../src/schema.mjs';
import { displayName } from '../../src/text.mjs';
import {
  EMPTY_NUTRIENTS,
  fillEnergy,
  parseServing,
  quantise,
  servingLabel,
  toPer100,
  validate,
} from '../lib/nutrients.mjs';

const API = 'https://api.nal.usda.gov/fdc/v1';

/**
 * FDC nutrient ids we keep. FDC also exposes ~150 others; carrying them would
 * multiply the record size for fields no one logs against on a phone.
 */
const NUTRIENT_ID = {
  1008: 'kcal',
  1003: 'proteinG',
  1005: 'carbG',
  1004: 'fatG',
  1079: 'fibreG',
  2000: 'sugarG',
  1063: 'sugarG', // "Sugars, Total" — older releases
  1093: 'sodiumMg',
  1258: 'satFatG',
};

/**
 * FDC returns nutrients in three different shapes depending on the endpoint,
 * and only the detail endpoint uses the modern nutrient ids:
 *
 *   /foods/search   -> { nutrientId: 1008, value: 165 }
 *   /food/{id}      -> { nutrient: { id: 1008 }, amount: 165 }
 *   /foods/list     -> { number: "208", amount: 165 }        <- legacy INFOODS tags
 *
 * The bulk CSV export uses ids. Supporting all three is what lets the sample
 * build and the full build share this mapping instead of diverging.
 */
const NUTRIENT_NUMBER = {
  208: 'kcal',
  203: 'proteinG',
  205: 'carbG',
  204: 'fatG',
  291: 'fibreG',
  269: 'sugarG',
  307: 'sodiumMg',
  606: 'satFatG',
};

/** `labelNutrients` uses names, not ids, and is stated per serving. */
const LABEL_KEY = {
  calories: 'kcal',
  protein: 'proteinG',
  carbohydrates: 'carbG',
  fat: 'fatG',
  fiber: 'fibreG',
  sugars: 'sugarG',
  sodium: 'sodiumMg',
  saturatedFat: 'satFatG',
};

const DATA_TYPE_SOURCE = {
  Foundation: SOURCE.USDA_FOUNDATION,
  'SR Legacy': SOURCE.USDA_SR_LEGACY,
  Branded: SOURCE.USDA_BRANDED,
  'Survey (FNDDS)': SOURCE.USDA_SR_LEGACY,
};

/**
 * The API key is a rate-limit identifier issued free by api.data.gov. It is read
 * from the environment and never written to disk or to any artefact.
 * `DEMO_KEY` works without registration at a much lower rate limit, which is
 * enough for the sample build but not for a full one.
 */
export function apiKey() {
  const k = process.env.FDC_API_KEY?.trim();
  if (!k) {
    console.warn(
      '[usda] FDC_API_KEY not set — falling back to DEMO_KEY (~30 req/hour).\n' +
        '       Get a free key at https://fdc.nal.usda.gov/api-key-signup.html\n' +
        '       and export FDC_API_KEY=... A full build needs a real key.',
    );
    return 'DEMO_KEY';
  }
  return k;
}

/**
 * Page through `/foods/list` for one data type.
 *
 * Full builds should use the bulk CSV/JSON exports instead — see README.
 * `/foods/list` exists here so the sample build exercises the same mapping code
 * the full build uses, rather than a fixture-only path that can rot unnoticed.
 *
 * @param {{dataType:string, pages?:number, pageSize?:number, fetchImpl?:typeof fetch}} opts
 * @returns {AsyncGenerator<any>}
 */
export async function* fetchList({ dataType, pages = 1, pageSize = 200, fetchImpl = fetch }) {
  const key = apiKey();
  for (let page = 1; page <= pages; page++) {
    const url =
      `${API}/foods/list?api_key=${encodeURIComponent(key)}` +
      `&dataType=${encodeURIComponent(dataType)}&pageSize=${pageSize}&pageNumber=${page}`;
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`FDC ${res.status} ${res.statusText} for ${dataType} p${page}`);
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) return;
    for (const item of batch) yield item;
    if (batch.length < pageSize) return;
  }
}

/**
 * Map one FDC food to a canonical record, or null if it is unusable.
 *
 * Handles both response shapes: the list/search shape (`nutrientId` + `value`)
 * and the detail shape (`nutrient.id` + `amount`).
 *
 * @param {any} food
 * @returns {import('../lib/record.mjs').CanonicalRecord | null}
 */
export function mapFood(food) {
  const source = DATA_TYPE_SOURCE[/** @type {keyof typeof DATA_TYPE_SOURCE} */ (food?.dataType)];
  if (source === undefined) return null;
  const raw = String(food.description ?? '').trim();
  if (!raw) return null;

  let n = { ...EMPTY_NUTRIENTS };
  let got = false;
  let energyReported = false;
  for (const fn of food.foodNutrients ?? []) {
    const id = fn.nutrientId ?? fn.nutrient?.id;
    const number = Number(fn.number ?? fn.nutrientNumber ?? fn.nutrient?.number);
    const key =
      NUTRIENT_ID[/** @type {keyof typeof NUTRIENT_ID} */ (id)] ??
      NUTRIENT_NUMBER[/** @type {keyof typeof NUTRIENT_NUMBER} */ (number)];
    if (!key) continue;
    const value = fn.value ?? fn.amount;
    if (!Number.isFinite(value)) continue;
    // Prefer the first hit: the 1063/2000 sugar pair would otherwise overwrite.
    if (key === 'sugarG' && n.sugarG > 0) continue;
    if (key === 'kcal') energyReported = true;
    n[/** @type {keyof typeof n} */ (key)] = value;
    got = true;
  }

  const serving = parseServing(
    food.servingSize != null && food.servingSizeUnit
      ? `${food.servingSize} ${food.servingSizeUnit}`
      : null,
  );

  // Branded records sometimes carry only `labelNutrients`, which is per serving.
  if (!got && food.labelNutrients && serving) {
    for (const [k, target] of Object.entries(LABEL_KEY)) {
      const v = food.labelNutrients[k]?.value;
      if (Number.isFinite(v)) {
        if (target === 'kcal') energyReported = true;
        n[/** @type {keyof typeof n} */ (target)] = v;
        got = true;
      }
    }
    if (got) n = toPer100(n, serving.grams);
  }
  if (!got) return null;

  const filled = fillEnergy(n);
  n = filled.n;
  const check = validate(n, { energyReported });
  if (!check.ok) return null;

  const gtin = normaliseGtin(food.gtinUpc);
  const brand = cleanBrand(food.brandName ?? food.brandOwner);

  return {
    source,
    sourceId: String(food.fdcId ?? food.ndbNumber ?? ''),
    name: displayName(raw),
    rawName: raw,
    brand,
    gtin: gtin?.value ?? null,
    gtinDigits: gtin?.digits ?? null,
    basis: serving?.basis === 'ml' ? 'ml' : 'g',
    n: quantise(n),
    servingGrams: serving?.grams ?? null,
    servingLabel: servingLabel(food.householdServingFullText) ?? null,
    servingEstimated: serving?.estimated ?? false,
    atwaterMismatch: check.atwaterMismatch,
    energyReported,
    energyDerived: filled.derived,
    // Foundation and SR Legacy are laboratory-analysed; Branded is label data.
    highConfidence: source !== SOURCE.USDA_BRANDED,
    aliases: aliasesFor(food, raw),
    popularity: 0,
    countries: ['us'],
  };
}

/**
 * FDC's `commonNames` and `additionalDescriptions` are exactly the synonyms a
 * user is likely to type ("garbanzo" for chickpeas), so they go into the index
 * as alias-field terms but never into the display name.
 * @param {any} food @param {string} raw
 */
function aliasesFor(food, raw) {
  const out = new Set();
  for (const field of [food.commonNames, food.additionalDescriptions]) {
    for (const part of String(field ?? '').split(/[;,]/)) {
      const t = part.trim();
      if (t && t.toLowerCase() !== raw.toLowerCase()) out.add(t);
    }
  }
  return [...out];
}

/**
 * Parse a GTIN, keeping the digit count.
 *
 * The integer is what the barcode table sorts and delta-encodes; the digit
 * count is what lets the reader hand back the exact string the scanner saw.
 * "0012345678905" (GTIN-13) and "012345678905" (GTIN-12) are the same number
 * and different barcodes.
 *
 * @param {unknown} v
 * @returns {{value:number, digits:number}|null}
 */
export function normaliseGtin(v) {
  if (v == null) return null;
  const digits = String(v).replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 14) return null;
  const num = Number(digits);
  if (!Number.isSafeInteger(num) || num <= 0) return null;
  return { value: num, digits: digits.length };
}

/** @param {unknown} v */
function cleanBrand(v) {
  const s = String(v ?? '').trim();
  if (!s || s.toLowerCase() === 'not a branded item') return null;
  return s.length > 48 ? s.slice(0, 48).trim() : s;
}
