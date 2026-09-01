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
import { brandUnlessItRepeatsName } from '../lib/record.mjs';
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

/**
 * How close a USDA food category is to "an ingredient somebody cooks with".
 *
 * This is USDA's own classification, not a vocabulary of ours, which is why it
 * is trustworthy in a way that guessing from the name is not. It exists because
 * name shape turned out to be a misleading proxy: the ranker put "Restaurant,
 * Chinese, lemon chicken" and "Babyfood, apple yogurt dessert" above plain
 * chicken and plain apples, and for the query "chicken" eight of the top eight
 * core hits were Chinese restaurant dishes.
 *
 * The split is between foods that are an ingredient or a plain preparation of
 * one, and foods that are somebody else's finished dish. Both are real foods and
 * both stay in the index — this only decides who is nearer the top.
 *
 * Unlisted categories get the neutral 0.6 rather than a penalty, so a new USDA
 * category never silently sinks.
 */
const CATEGORY_PRIOR = {
  'Vegetables and Vegetable Products': 1.0,
  'Fruits and Fruit Juices': 1.0,
  'Dairy and Egg Products': 1.0,
  'Cereal Grains and Pasta': 1.0,
  'Legumes and Legume Products': 1.0,
  'Nut and Seed Products': 1.0,
  'Poultry Products': 0.95,
  'Beef Products': 0.95,
  'Pork Products': 0.95,
  'Finfish and Shellfish Products': 0.95,
  'Lamb, Veal, and Game Products': 0.9,
  'Fats and Oils': 0.9,
  'Spices and Herbs': 0.85,
  'Beverages': 0.7,
  'Breakfast Cereals': 0.7,
  'Baked Products': 0.65,
  'Soups, Sauces, and Gravies': 0.55,
  'Sausages and Luncheon Meats': 0.55,
  'American Indian/Alaska Native Foods': 0.5,
  'Snacks': 0.4,
  'Sweets': 0.4,
  'Meals, Entrees, and Side Dishes': 0.3,
  'Baby Foods': 0.2,
  'Fast Foods': 0.2,
  'Restaurant Foods': 0.2,
};

/** Neutral prior for a category we do not recognise, and for branded goods. */
export const NEUTRAL_CATEGORY_PRIOR = 0.6;

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

  // `labelNutrients` is what the printed panel says, per serving. Read it
  // always, not only as a fallback: on a Branded record it is a second,
  // independent measurement of the same product and it is what
  // `lib/select.mjs` cross-checks the per-100 g array against.
  const label = readLabel(food.labelNutrients);

  // Branded records sometimes carry only `labelNutrients`, which is per serving.
  if (!got && label.got && serving) {
    n = { ...n, ...label.n };
    if (label.energyReported) energyReported = true;
    got = true;
    n = toPer100(n, serving.grams);
  }
  if (!got) return null;

  const filled = fillEnergy(n);
  n = filled.n;
  const check = validate(n, { energyReported });
  if (!check.ok) return null;

  const gtin = normaliseGtin(food.gtinUpc);
  const brand = brandUnlessItRepeatsName(cleanBrand(food.brandName ?? food.brandOwner), displayName(raw));

  // Branded foods state a serving on the label. Ingredients — Foundation, SR
  // Legacy — do not: their natural basis is per 100 g and their household
  // measures live in `foodPortions` ("1 cup, chopped", "1 medium"). Reading
  // them is what turns "chicken breast, per 100 g" into something a user can
  // log in one tap.
  const portion = serving ? null : bestPortion(food.foodPortions);

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
    servingGrams: serving?.grams ?? portion?.grams ?? null,
    servingLabel: servingLabel(food.householdServingFullText) ?? portion?.label ?? null,
    servingEstimated: serving?.estimated ?? false,
    reportedPerServing: label.got ? label.n : null,
    atwaterMismatch: check.atwaterMismatch,
    energyReported,
    energyDerived: filled.derived,
    // Foundation and SR Legacy are laboratory-analysed; Branded is label data.
    highConfidence: source !== SOURCE.USDA_BRANDED,
    categoryPrior:
      CATEGORY_PRIOR[
        /** @type {keyof typeof CATEGORY_PRIOR} */ (
          typeof food.foodCategory === 'string' ? food.foodCategory : food.foodCategory?.description
        )
      ] ?? NEUTRAL_CATEGORY_PRIOR,
    aliases: aliasesFor(food, raw),
    popularity: 0,
    countries: ['us'],
  };
}

/**
 * Read the printed nutrition panel. Values are per serving, in label units.
 * @param {any} labelNutrients
 * @returns {{n:Partial<import('../lib/nutrients.mjs').Nutrients>, got:boolean, energyReported:boolean}}
 */
function readLabel(labelNutrients) {
  /** @type {any} */
  const n = {};
  let got = false;
  let energyReported = false;
  if (!labelNutrients) return { n, got, energyReported };
  for (const [k, target] of Object.entries(LABEL_KEY)) {
    const v = labelNutrients[k]?.value;
    if (!Number.isFinite(v)) continue;
    if (target === 'kcal') energyReported = true;
    n[target] = v;
    got = true;
  }
  return { n, got, energyReported };
}

/**
 * Pick the household measure most likely to be the one a user reaches for.
 *
 * FDC lists several portions per ingredient and they are not equally useful.
 * "1 cup, chopped" beats "1 cup, NFS", both beat a bare gram weight with no
 * measure at all, and a portion whose text is only a qualifier ("Quantity not
 * specified") is worse than none — it renders as a serving option that tells
 * the user nothing.
 *
 * @param {any[]|undefined} portions
 * @returns {{grams:number, label:string}|null}
 */
function bestPortion(portions) {
  if (!Array.isArray(portions)) return null;

  // The two USDA releases disagree about where the measure lives. Foundation
  // fills `measureUnit` ("cup") and uses `modifier` for a qualifier
  // ("drained"). SR Legacy sets every `measureUnit.name` to the literal string
  // "undetermined" and puts the whole measure in `modifier` ("cup, chopped",
  // "bar (1 oz)"), with no `amount` at all. Both must work.
  const ordered = [...portions].sort(
    (a, b) => (Number(a?.sequenceNumber) || 99) - (Number(b?.sequenceNumber) || 99),
  );

  /** @type {{grams:number, label:string, rank:number}|null} */
  let best = null;
  for (const p of ordered) {
    const grams = Number(p?.gramWeight);
    if (!Number.isFinite(grams) || grams <= 0 || grams > 2000) continue;

    const name = String(p?.measureUnit?.name ?? '').trim();
    const abbr = String(p?.measureUnit?.abbreviation ?? '').trim();
    const modifier = String(p?.modifier ?? '').trim();
    const known = Boolean(name) && name !== 'undetermined';
    // Prefer the abbreviation: "2 tbsp" fits a 48px row, "2 tablespoon" fights
    // it, and the abbreviation is the form a recipe would use anyway.
    const unit = known ? (abbr && abbr !== 'undetermined' ? abbr : name) : '';
    const measure = known ? unit : modifier;
    // "RACC" is the Reference Amount Customarily Consumed — a regulatory
    // quantity, not something anybody eats. "Quantity not specified" renders
    // as a serving option that tells the user nothing.
    if (!measure || /^(racc|quantity not specified)$/i.test(measure)) continue;

    const amount = Number(p?.amount ?? p?.value);
    const qty = Number.isFinite(amount) && amount > 0 ? amount : 1;
    const extra = known && modifier && !/^\d/.test(modifier) ? `, ${modifier}` : '';
    const label = servingLabel(`${trimNumber(qty)} ${measure}${extra}`);
    if (!label) continue;

    // Prefer a household measure at a round amount: "1 cup" over "0.5 cup",
    // and either over "3 oz", which is a mass the user's scale already gives
    // them. Ties break on `sequenceNumber` — the order FDC's own curators
    // chose — because the loop keeps the first of an equal rank.
    let rank = 0;
    if (qty === 1) rank += 2;
    if (
      /\b(cup|tbsp|tablespoon|tsp|teaspoon|slice|piece|medium|large|small|each|bar|fruit|item|serving|container|package)\b/i.test(
        measure,
      )
    ) {
      rank += 3;
    }
    if (/^(oz|g|gram|grams|ml|lb)\b/i.test(measure)) rank -= 1;
    if (best == null || rank > best.rank) best = { grams, label, rank };
  }
  return best ? { grams: best.grams, label: best.label } : null;
}

/** @param {number} v */
function trimNumber(v) {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
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
