/**
 * Ranking — "how likely is someone to search for this food?"
 *
 * The index is a budget, not a corpus (ADR-0006). Ranking decides what fits.
 * Rank order is also the record order in the artefact, so record id 0 is the
 * most likely food and the reader can use "lower id wins" as a free tie-break
 * with no stored score. That is why no score column exists in the format.
 *
 * WHAT WE DELIBERATELY DO NOT USE: our own users' search queries. Aggregated
 * query logs would be the best possible signal, and collecting them would mean
 * building a telemetry pipeline over what people eat. Constitution rule 6 rules
 * out data collection that exists to improve our product rather than the user's
 * experience, and food logs are about as sensitive as personal data gets. Every
 * signal below is either a public upstream statistic or computable from the
 * record itself.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { SOURCE } from '../../src/schema.mjs';
import { NEUTRAL_CATEGORY_PRIOR } from '../sources/usda.mjs';

/**
 * Prior by source. Generic whole foods dominate real searches — "chicken
 * breast", "banana", "olive oil" — and those live in Foundation and SR Legacy.
 * Branded products are long and numerous and mostly reached by barcode scan,
 * so they earn their place through popularity rather than through their source.
 */
const SOURCE_PRIOR = {
  [SOURCE.USDA_FOUNDATION]: 1.0,
  [SOURCE.USDA_SR_LEGACY]: 0.92,
  [SOURCE.USDA_BRANDED]: 0.35,
  [SOURCE.OFF]: 0.3,
};

/**
 * `categoryPrior` was added after measuring what the shipped index actually
 * returned for one-word staple queries: all eight of the top core hits for
 * "chicken" were Chinese restaurant dishes, and five of eight for "apple" were
 * babyfood, pie and dessert. USDA's own food category separates "an ingredient"
 * from "somebody else's finished dish" far better than any signal derived from
 * the name, which is where its 0.15 comes from.
 *
 * It is paid for out of the two terms that measurement showed were weak:
 *
 *  - `nameQuality` 0.10 -> 0.05. It was actively harmful: USDA names generic
 *    whole foods with comma chains ("Potatoes, flesh and skin, raw"), so a
 *    per-comma penalty taxed exactly the staples and rewarded short
 *    marketing-shaped names like "Potato flour". Relaxing it helped and was not
 *    enough; the residual value here is the junk-name detection below it.
 *  - `completeness` 0.15 -> 0.10. It has largely saturated since `lib/select.mjs`
 *    made a serving label an entry requirement — a term that nearly every
 *    surviving record scores the same on cannot order them.
 *
 * `popularity` is deliberately untouched: it is the only signal ordering the
 * branded OFF shard, and nutrition measured 99.4% recall against it.
 */
const WEIGHTS = {
  sourcePrior: 0.35,
  popularity: 0.3,
  categoryPrior: 0.15,
  completeness: 0.1,
  nameQuality: 0.05,
  locale: 0.05,
};

/**
 * @param {import('./record.mjs').CanonicalRecord} r
 * @param {{maxPopularity:number, locale?:string}} ctx
 * @returns {number} score in [0, 1]
 */
export function score(r, ctx) {
  const prior = SOURCE_PRIOR[/** @type {keyof typeof SOURCE_PRIOR} */ (r.source)] ?? 0.2;

  // Scan counts are Zipf-distributed: the top product has ~1e4 scans and the
  // median has ~1. A linear normalisation would collapse everything below the
  // top hundred to zero, so compare logs.
  const pop =
    ctx.maxPopularity > 0
      ? Math.log1p(Math.max(0, r.popularity)) / Math.log1p(ctx.maxPopularity)
      : 0;

  return clamp01(
    WEIGHTS.sourcePrior * prior +
      WEIGHTS.popularity * pop +
      WEIGHTS.categoryPrior * (r.categoryPrior ?? NEUTRAL_CATEGORY_PRIOR) +
      WEIGHTS.completeness * completeness(r) +
      WEIGHTS.nameQuality * nameQuality(r) +
      WEIGHTS.locale * localeFit(r, ctx.locale ?? 'us'),
  );
}

/**
 * A record you cannot log a meal from is worthless however popular it is:
 * energy plus the three macros is the floor, and a serving size is what turns
 * "per 100 g" into two taps instead of a calculation.
 * @param {import('./record.mjs').CanonicalRecord} r
 */
function completeness(r) {
  let s = 0;
  if (r.n.kcal > 0) s += 0.3;
  if (r.n.proteinG > 0 || r.n.carbG > 0 || r.n.fatG > 0) s += 0.3;
  if (r.servingGrams != null) s += 0.2;
  if (r.n.fibreG > 0 || r.n.sugarG > 0 || r.n.sodiumMg > 0) s += 0.1;
  if (r.highConfidence) s += 0.1;
  return clamp01(s - (r.atwaterMismatch ? 0.2 : 0));
}

/**
 * Short, clean names are both more likely to be typed and more likely to be the
 * generic entry a user actually wanted. Long comma-chained USDA descriptions
 * ("Beef, chuck, arm pot roast, separable lean only, trimmed to 0" fat, all
 * grades, cooked, braised") are real foods but nobody searches for them.
 * @param {import('./record.mjs').CanonicalRecord} r
 */
function nameQuality(r) {
  const words = r.name.split(/\s+/).length;
  const commas = (r.rawName.match(/,/g) ?? []).length;
  let s = 1;

  // THE FIRST TWO CLAUSES AND SIX WORDS ARE FREE, and that allowance is the
  // whole point of this function's shape.
  //
  // USDA's canonical name for a generic whole food is comma-chained by
  // convention — "Potatoes, flesh and skin, raw", "Apples, raw, without skin",
  // "Milk, whole, 3.25% milkfat". Charging per comma from the first one
  // therefore taxed precisely the plain staples people search for most, while
  // leaving derived products with short marketing-shaped names untaxed. The
  // measured result: "Potato flour" scored 0.668 and landed at core record 4,
  // "Potatoes, flesh and skin, raw" scored 0.636 and landed at 1,785 — and the
  // entire 0.032 gap was this function. Same for "Apple fruit butters" ahead of
  // "Apples, raw, without skin". Nutrition could not surface either staple at
  // k=8 because the plain record sat ~350 deep in the candidate pool.
  //
  // The original intent is still served: what nobody searches for is not a
  // two-clause name, it is "Beef, chuck, arm pot roast, separable lean only,
  // trimmed to 0" fat, all grades, cooked, braised" — eight clauses, sixteen
  // words. Those still lose most of this term.
  s -= Math.min(0.5, Math.max(0, words - 6) * 0.06);
  s -= Math.min(0.4, Math.max(0, commas - 2) * 0.12);

  if (/\b(upc|gtin|sku|item\s*#|\d{6,})\b/i.test(r.name)) s -= 0.4;
  if (r.name.length > 60) s -= 0.2;
  return clamp01(s);
}

/**
 * v1 ships a US-weighted index because both upstreams are US-heavy and the
 * download budget is fixed. This is a known bias, not an oversight: it is
 * exactly what docs/contribution-loop.md is designed to correct over time, and
 * it is a single parameter here so that shipping a per-region index later is a
 * build-matrix change rather than a redesign.
 * @param {import('./record.mjs').CanonicalRecord} r @param {string} locale
 */
function localeFit(r, locale) {
  if (r.countries.length === 0) return 0.5;
  return r.countries.some((c) => c.includes(locale)) ? 1 : 0.2;
}

/** @param {number} v */
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Score every record and sort descending. Ties break on the upstream id so the
 * build is deterministic — two runs over the same input must produce
 * byte-identical artefacts, or the integrity hash is meaningless.
 * @param {import('./record.mjs').CanonicalRecord[]} records
 * @param {{locale?:string}} [opts]
 */
export function rankAll(records, opts = {}) {
  const maxPopularity = records.reduce((m, r) => Math.max(m, r.popularity ?? 0), 0);
  const ctx = { maxPopularity, ...(opts.locale ? { locale: opts.locale } : {}) };
  for (const r of records) r.score = score(r, ctx);
  return records.sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0),
  );
}
