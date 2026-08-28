/**
 * Deduplication.
 *
 * USDA Branded and Open Food Facts overlap heavily — both catalogue US grocery
 * barcodes — and a duplicate is worse than a miss: two "Cheerios" rows in a
 * search result mid-workout is a decision the user has to make and shouldn't.
 *
 * THE LICENCE CONSTRAINT SHAPES THE ALGORITHM. Merging is one-directional:
 * when a USDA record and an OFF record are the same product, we keep the USDA
 * record and *suppress* the OFF one. We never copy an OFF field value into a
 * core record, because that would make the public-domain shard a derivative of
 * an ODbL database (NOTICE.md §2.4). Suppression is a decision not to copy, and
 * a decision not to copy carries no licence consequences.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { SHARD } from '../../src/schema.mjs';
import { fingerprint } from '../../src/text.mjs';
import { shardOf } from './record.mjs';

/**
 * @typedef {object} DedupeStats
 * @property {number} input
 * @property {number} byGtinWithinShard
 * @property {number} offSuppressedByCore
 * @property {number} byFingerprint
 * @property {number} output
 */

/**
 * @param {import('./record.mjs').CanonicalRecord[]} records  ranked, best first
 * @returns {{records: import('./record.mjs').CanonicalRecord[], stats: DedupeStats}}
 */
export function dedupe(records) {
  const stats = {
    input: records.length,
    byGtinWithinShard: 0,
    offSuppressedByCore: 0,
    byFingerprint: 0,
    output: 0,
  };

  // Pass 1 — collect every GTIN the core shard claims. Core wins on any tie
  // because it is public domain and because USDA values are label-verified.
  const coreGtins = new Set();
  for (const r of records) {
    if (shardOf(r) === SHARD.CORE && r.gtin != null) coreGtins.add(r.gtin);
  }

  /** @type {Map<string, import('./record.mjs').CanonicalRecord>} */
  const byGtin = new Map();
  /** @type {Map<string, import('./record.mjs').CanonicalRecord>} */
  const byPrint = new Map();
  /** @type {import('./record.mjs').CanonicalRecord[]} */
  const out = [];

  // Input is already sorted best-first, so the first record to claim a key is
  // the keeper and later collisions are folded into it.
  for (const r of records) {
    const shard = shardOf(r);

    if (shard === SHARD.OFF && r.gtin != null && coreGtins.has(r.gtin)) {
      stats.offSuppressedByCore++;
      continue;
    }

    if (r.gtin != null) {
      const key = `${shard}:${r.gtin}`;
      const kept = byGtin.get(key);
      if (kept) {
        absorb(kept, r);
        stats.byGtinWithinShard++;
        continue;
      }
      byGtin.set(key, r);
    }

    // Barcodeless records (generic foods) collide on name + brand + a coarse
    // nutrient signature. The nutrient part matters: "Chicken breast, raw" and
    // "Chicken breast, roasted" fingerprint differently on name anyway, but
    // "Milk, whole" appears from several USDA releases with identical values.
    const print = `${shard}:${fingerprint(`${r.brand ?? ''} ${r.rawName}`)}:${nutrientBucket(r)}`;
    const twin = byPrint.get(print);
    if (twin) {
      absorb(twin, r);
      stats.byFingerprint++;
      continue;
    }
    byPrint.set(print, r);
    out.push(r);
  }

  stats.output = out.length;
  return { records: out, stats };
}

/**
 * Fold the loser into the keeper. Only aliases and popularity move, and only
 * *within* a shard — `dedupe` never calls this across the shard boundary, so no
 * OFF-derived value can reach a core record.
 * @param {import('./record.mjs').CanonicalRecord} keeper
 * @param {import('./record.mjs').CanonicalRecord} loser
 */
function absorb(keeper, loser) {
  if (shardOf(keeper) !== shardOf(loser)) {
    throw new Error('refusing to merge records across a shard boundary — see NOTICE.md §2.4');
  }
  const seen = new Set(keeper.aliases.map((a) => a.toLowerCase()));
  for (const a of [loser.rawName, ...loser.aliases]) {
    const k = a.toLowerCase();
    if (k && k !== keeper.rawName.toLowerCase() && !seen.has(k)) {
      seen.add(k);
      keeper.aliases.push(a);
    }
  }
  keeper.popularity = Math.max(keeper.popularity, loser.popularity);
  // A serving size is the one field worth taking from a duplicate: it is
  // factual, frequently missing, and its absence costs the user arithmetic.
  if (keeper.servingGrams == null && loser.servingGrams != null) {
    keeper.servingGrams = loser.servingGrams;
    keeper.servingLabel = loser.servingLabel;
    keeper.servingEstimated = loser.servingEstimated;
  }
}

/**
 * Coarse nutrient signature — 10 kcal and 1 g buckets. Tight enough that two
 * genuinely different foods rarely collide, loose enough to absorb rounding
 * differences between upstream releases.
 * @param {import('./record.mjs').CanonicalRecord} r
 */
function nutrientBucket(r) {
  const b = (/** @type {number} */ v, /** @type {number} */ size) => Math.round(v / size);
  return [
    b(r.n.kcal, 10),
    b(r.n.proteinG, 1),
    b(r.n.carbG, 1),
    b(r.n.fatG, 1),
  ].join('/');
}
