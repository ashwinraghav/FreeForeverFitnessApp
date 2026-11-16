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
 *
 * ── 2026-09-01: locale 0.05 -> 0.25, everything else rescaled ──────────────
 *
 * The other five weights are scaled by 0.75/0.95 and rounded, which leaves
 * their ratios to each other essentially unchanged. That is the point: this
 * change gives locale more absolute authority without re-opening any of the
 * arguments above about how source, popularity, category, completeness and
 * name quality trade off against one another. They still sum to 1.
 *
 * See `localeFit` below for what was measured and why 0.05 was not merely weak
 * but inert.
 */
/**
 * The locale a build warms its cache for when nothing says otherwise.
 *
 * One constant, imported by the build's argument parser, so that "the default
 * locale" cannot mean two different things in two files. It used to: `score()`
 * fell back to `us` independently of `parseArgs`, which is harmless only while
 * they agree.
 */
export const DEFAULT_LOCALE = 'in';

const WEIGHTS = {
  sourcePrior: 0.28,
  popularity: 0.24,
  categoryPrior: 0.12,
  completeness: 0.08,
  nameQuality: 0.03,
  locale: 0.25,
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
      WEIGHTS.locale * localeFit(r, ctx.locale ?? DEFAULT_LOCALE),
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
 * Country tags that count as "sold in this locale", by build locale.
 *
 * A table rather than a substring test, because the substring test was wrong in
 * both directions and the errors cancelled into looking like nothing was
 * happening. `sources/off.mjs` stores OFF's `countries_tags` with the `en:`
 * prefix stripped, so the values are slugs — `united-states`, `india`,
 * `new-zealand` — while `sources/usda.mjs` writes the bare code `us`.
 *
 * Add a locale here before building for it. An unknown locale falls back to
 * matching its own code, which is right for USDA records and matches nothing on
 * OFF — a thin index, but an honest one, and the build's `localeMix` report
 * makes it visible immediately rather than three weeks later.
 */
const LOCALE_COUNTRIES = {
  us: ['us', 'united-states', 'usa', 'united-states-of-america'],
  ca: ['ca', 'canada'],
  in: ['in', 'india'],
  gb: ['gb', 'uk', 'united-kingdom'],
  au: ['au', 'australia'],
  nz: ['nz', 'new-zealand'],
  fr: ['fr', 'france'],
  de: ['de', 'germany'],
  es: ['es', 'spain'],
  it: ['it', 'italy'],
  br: ['br', 'brazil'],
  mx: ['mx', 'mexico'],
  za: ['za', 'south-africa'],
  ae: ['ae', 'united-arab-emirates'],
  sg: ['sg', 'singapore'],
  jp: ['jp', 'japan'],
};

/**
 * Tags that state no country. `en:world` is OFF's "sold everywhere / nobody
 * filled this in", which is an absence of evidence rather than evidence of
 * local availability, so it scores as unknown for every locale rather than as
 * a match for every locale. Roughly 2% of OFF rows carry it; treating it as a
 * match would hand that 2% a full locale bonus in every build on no evidence.
 */
const NO_COUNTRY = new Set(['world', 'en:world', '']);

/**
 * How well this record fits the locale the cache is being warmed for.
 *
 * ADR-0030 rule 1 is the constraint on this function: **locale may rank and may
 * pre-cache; locale must never gate existence.** Nothing here filters. It
 * reorders, and `fitToBudget` then keeps the top of the order that fits 4 MB.
 * Everything below that line still exists — it ships in the full pack
 * (ADR-0033) and is unaffected by this weight.
 *
 * WHAT WAS MEASURED, 2026-09-01, and why 0.05 was worse than weak.
 *
 * The old test was `r.countries.some((c) => c.includes(locale))` — a substring
 * match. On the shipped `--locale us` build that is not a weak signal, it is a
 * *misdirected* one:
 *
 *  - `'united-states'.includes('us')` is **false**. There is no `us` substring
 *    in it. Every OFF record sold in the United States therefore scored 0.2,
 *    the foreign-product value, on a US-locale build.
 *  - `'australia'.includes('us')` and `'austria'.includes('us')` are **true**.
 *    The only OFF rows the US build ever awarded 1.0 to were Australian and
 *    Austrian ones.
 *  - USDA rows carry the bare code `us`, so the entire core shard scored 1.0 —
 *    a constant, and a constant cannot order anything.
 *
 * Net effect on the shipped index: the term was very nearly a constant within
 * each shard (0.2 across OFF, 1.0 across core), and shards are fitted to
 * separate budgets, so it changed almost nothing about what shipped. That is
 * consistent with the measured 890-prefix share of the OFF shard — 450 of
 * 63,782 records, 0.71% — being simply what OFF's corpus and scan counts hand
 * you when nothing biases them.
 *
 * The substring test is also actively dangerous for the locale this build is
 * for: `'in'` is a substring of `argentina`, `china`, `finland`, `singapore`,
 * `spain`, `ukraine` and `philippines`. Raising the weight without fixing the
 * match would have bought a strongly-weighted signal for the wrong countries.
 *
 * On the weight itself. At 0.05 the whole term spans 0.04 of a score in [0,1];
 * at 0.25 a locale match is worth 0.20, against popularity's full span of 0.24
 * — so being sold where the user lives is worth about as much as going from
 * unscanned to the most-scanned product on Open Food Facts. Deliberately that
 * large: at the 4 MB cut the OFF shard keeps 63,782 of 208,988 candidates, and
 * a term that cannot lift a zero-scan local product over a mid-popularity
 * foreign one cannot stock a shelf — it can only decide who falls off the
 * cliff, which is what the old weight did.
 *
 * Exported so the substring defect above has a regression test that names it.
 * A test that could only reach this through `rankAll` would have passed on the
 * broken version — the term was inert, so nothing it touched moved.
 *
 * @param {{countries:string[]}} r @param {string} locale
 */
export function localeFit(r, locale) {
  const wanted = LOCALE_COUNTRIES[/** @type {keyof typeof LOCALE_COUNTRIES} */ (locale)] ?? [locale];
  let sawACountry = false;
  for (const raw of r.countries) {
    // `sources/off.mjs` strips `en:`; a tag namespaced in another language
    // reaches us intact, so strip any `<lang>:` here rather than comparing
    // `fr:india` against `india` and calling it foreign.
    const c = raw.trim().toLowerCase().replace(/^[a-z]{2,3}:/, '');
    if (NO_COUNTRY.has(c)) continue;
    if (wanted.includes(c)) return 1;
    sawACountry = true;
  }
  // No country stated is not the same as stated-and-elsewhere. Scoring it as
  // foreign would penalise every record whose contributor left the field blank,
  // which is a data-entry fact about OFF and not a fact about the product.
  return sawACountry ? 0.2 : 0.5;
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
