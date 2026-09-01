/**
 * The canonical record — the pipeline's internal representation between
 * normalisation and encoding. Every source adapter emits this shape; the
 * encoder consumes it; the NDJSON dump is a direct serialisation of it.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { SHARD, SOURCE_SHARD } from '../../src/schema.mjs';
import { tokenise } from '../../src/text.mjs';

/**
 * @typedef {object} CanonicalRecord
 * @property {number}        source          SOURCE.* code
 * @property {string}        sourceId        upstream id; the OFF barcode, or the FDC id
 * @property {string}        name            display name, already humanised
 * @property {string}        rawName         upstream name, kept for debugging and dedupe
 * @property {string|null}   brand
 * @property {number|null}   gtin            barcode as an integer, or null
 * @property {number|null}   [gtinDigits]    digit count, so leading zeros survive the round trip
 * @property {Array<{value:number, digits:number}>} [extraGtins]
 *   Barcodes of duplicate rows that dedupe folded into this one. They are
 *   emitted into the barcode table alongside the primary GTIN so that scanning
 *   any of a product's regional SKUs reaches the row we kept, and — for OFF —
 *   so every contributed product stays linkable (NOTICE.md §2.2).
 * @property {'g'|'ml'}      basis           nutrients are per 100 g or per 100 ml
 * @property {import('./nutrients.mjs').Nutrients} n  per-100 nutrients, already quantised
 * @property {number|null}   servingGrams
 * @property {string|null}   servingLabel    household measure, e.g. "1 cup"
 * @property {boolean}       servingEstimated
 * @property {boolean}       atwaterMismatch
 * @property {boolean}       energyReported  upstream stated an energy value, even if it was zero
 * @property {boolean}       energyDerived   energy was computed from the macros, not stated
 * @property {boolean}       highConfidence
 * @property {string[]}      aliases
 * @property {number}        [categoryPrior] how close the upstream food category is to "an
 *   ingredient somebody cooks with", in [0,1]. USDA's own classification; see
 *   CATEGORY_PRIOR in sources/usda.mjs. Build-time only, read by rank.mjs.
 * @property {number}        popularity      upstream scan count, 0 when unknown
 * @property {string[]}      countries
 * @property {number}        [score]         assigned by rank.mjs
 * @property {Partial<import('./nutrients.mjs').Nutrients>|null} [reportedPerServing]
 *   Upstream's OWN per-serving statement, as printed on the label — not
 *   derived. A build-time field only: `lib/select.mjs` cross-checks it against
 *   the per-100 values and nothing downstream of selection reads it. It is
 *   deliberately absent from `toNdjson` and from the binary format, because a
 *   value we only trust enough to audit with is not a value to ship.
 */

/**
 * Drop a brand that merely repeats the product's own name.
 *
 * Open Food Facts contributors regularly fill the brand field with the product
 * name, because the form asks for both and the packet only says one thing. The
 * result is a record named "Milk" whose brand is "Milk", and one named "Chicken
 * Breast" whose brand is "Chicken Breast ALDI". Those score as though a brand
 * had independently confirmed the name — nutrition measured both taking position
 * 1 for "milk" and "chicken breast", ahead of the plain USDA records.
 *
 * A brand is only information if it says something the name does not. When the
 * name's tokens are already all present in the brand, it says nothing, and
 * `null` is the honest value. It is also the value that belongs in the published
 * ODbL distribution, which otherwise repeats the noise.
 *
 * THE DIRECTION OF THE TEST IS THE WHOLE RULE, and the first version had it
 * backwards. It asked "is the NAME contained in the BRAND", which is a different
 * and equally reasonable question — it is the one the nutrition ranker asks,
 * because a brand that merely echoes the name is not independent evidence and
 * should not earn a second scoring bonus. Borrowing that predicate for this job
 * was the mistake: withholding a bonus is reversible and costs nothing if wrong,
 * whereas this function writes `null` into the shipped artefact and into the
 * published ODbL derived database, where a deleted token is gone for good.
 *
 * So it destroyed exactly the informative cases. "Chicken Breast ALDI" on a
 * record named "Chicken Breast" lost ALDI — the single most informative token in
 * the row — and "COCA-COLA" on a record named "Cola" lost "Coca".
 *
 * SO THE RULE IS EQUALITY, NOT CONTAINMENT IN EITHER DIRECTION. Measured over
 * the 3,345,487 corpus records that have both a brand and a name:
 *
 *   name inside brand  (the original, wrong)    35,010 nulled
 *     of which token sets were equal            30,760  (88% — genuinely redundant)
 *     of which the brand said MORE               4,250  (12% — destroyed)
 *   brand inside name  (the obvious correction) 390,661 nulled
 *
 * The correction fixes the 4,250 and nulls another 359,901 that nobody reported
 * a defect about — every record whose brand is a strict subset of its name, like
 * brand "Nestle" on "Nestle Milo". Those brands are redundant for *display*, but
 * nulling them also deletes the structured brand field, and the least
 * recoverable thing this function can do is delete. Equality nulls 30,760: only
 * the cases where the two fields carry literally the same tokens.
 *
 * Equality satisfies every case the integrator specified, including both that
 * the containment version got wrong — "Chicken Breast ALDI" keeps ALDI and
 * "COCA-COLA" on a record named "Cola" keeps Coca — while writing 13x fewer
 * nulls into the shipped artefact and the published ODbL database.
 *
 * It also restores the division of labour: this deletes only the provably
 * redundant, and the nutrition ranker withholds a duplicate scoring bonus for
 * the echo cases it leaves behind. Reversible layer first.
 *
 * @param {string|null} brand @param {string} name
 * @returns {string|null}
 */
export function brandUnlessItRepeatsName(brand, name) {
  if (!brand) return null;
  const nameTokens = new Set(tokenise(name));
  const brandTokens = new Set(tokenise(brand));
  if (nameTokens.size === 0 || brandTokens.size === 0) return brand;
  if (brandTokens.size !== nameTokens.size) return brand;
  for (const t of brandTokens) if (!nameTokens.has(t)) return brand;
  return null;
}

/** @param {CanonicalRecord} r */
export function shardOf(r) {
  const s = SOURCE_SHARD[/** @type {keyof typeof SOURCE_SHARD} */ (r.source)];
  if (s === undefined) throw new Error(`record has unknown source ${r.source}`);
  return s;
}

/** @param {CanonicalRecord} r */
export function isOff(r) {
  return shardOf(r) === SHARD.OFF;
}

/**
 * The public NDJSON line. This is the format published under ODbL to satisfy
 * §4.6 parallel distribution (NOTICE.md §2.2), so it must stay plain, stable
 * and self-describing. Field names match the runtime `Food` object exactly, so
 * the nutrition team can code against one vocabulary.
 * @param {CanonicalRecord} r
 */
export function toNdjson(r) {
  return JSON.stringify({
    sourceId: r.sourceId,
    source: r.source,
    name: r.name,
    brand: r.brand,
    barcode: r.gtin == null ? null : String(r.gtin).padStart(r.gtinDigits ?? String(r.gtin).length, '0'),
    // Additional barcodes for the same product, from rows folded in by dedupe.
    // Published rather than dropped: each one is a product an OFF contributor
    // filled in, and OFF's terms credit them by a link to that product.
    alsoBarcodes: (r.extraGtins ?? []).map((g) => String(g.value).padStart(g.digits, '0')),
    basis: r.basis,
    per100: r.n,
    servingGrams: r.servingGrams,
    servingLabel: r.servingLabel,
    aliases: r.aliases,
    flags: {
      servingEstimated: r.servingEstimated,
      atwaterMismatch: r.atwaterMismatch,
      energyDerived: r.energyDerived,
      highConfidence: r.highConfidence,
    },
  });
}
