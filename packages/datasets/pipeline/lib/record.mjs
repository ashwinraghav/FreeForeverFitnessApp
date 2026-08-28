/**
 * The canonical record — the pipeline's internal representation between
 * normalisation and encoding. Every source adapter emits this shape; the
 * encoder consumes it; the NDJSON dump is a direct serialisation of it.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { SHARD, SOURCE_SHARD } from '../../src/schema.mjs';

/**
 * @typedef {object} CanonicalRecord
 * @property {number}        source          SOURCE.* code
 * @property {string}        sourceId        upstream id; the OFF barcode, or the FDC id
 * @property {string}        name            display name, already humanised
 * @property {string}        rawName         upstream name, kept for debugging and dedupe
 * @property {string|null}   brand
 * @property {number|null}   gtin            barcode as an integer, or null
 * @property {number|null}   [gtinDigits]    digit count, so leading zeros survive the round trip
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
 * @property {number}        popularity      upstream scan count, 0 when unknown
 * @property {string[]}      countries
 * @property {number}        [score]         assigned by rank.mjs
 */

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
