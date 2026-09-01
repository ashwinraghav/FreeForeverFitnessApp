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
import {
  brandKey,
  flavourSignature,
  identityCompatible,
  identityTokens,
  macrosAgree,
  representativeScore,
  variantSignature,
} from './variants.mjs';

/**
 * @typedef {object} DedupeStats
 * @property {number} input
 * @property {number} byGtinWithinShard
 * @property {number} offSuppressedByCore
 * @property {number} byFingerprint
 * @property {number} byProductCluster
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
    byProductCluster: 0,
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
  /** Bucket key -> indices into `out`, so a merge can replace the kept row. */
  /** @type {Map<string, number[]>} */
  const byCluster = new Map();
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

    // The same branded product, transcribed by several contributors under
    // different barcodes. Nothing above catches it: the GTINs really are
    // different, and the names differ by enough punctuation that the
    // fingerprint does not collide. See lib/variants.mjs for why this is
    // built out of blockers rather than a similarity score.
    const cluster = clusterKey(shard, r);
    if (cluster) {
      const peers = byCluster.get(cluster);
      if (peers) {
        const at = peers.findIndex((p) => sameProduct(out[p], r));
        if (at >= 0) {
          const slot = /** @type {number} */ (peers[at]);
          const kept = /** @type {import('./record.mjs').CanonicalRecord} */ (out[slot]);
          // Merge, then decide which row the user should be shown. The keeper's
          // SLOT is preserved — that is its rank, earned before this stage —
          // but the row occupying it may be the challenger.
          if (representativeScore(r) > representativeScore(kept)) {
            absorb(r, kept);
            out[slot] = r;
          } else {
            absorb(kept, r);
          }
          stats.byProductCluster++;
          continue;
        }
        peers.push(out.length);
      } else {
        byCluster.set(cluster, [out.length]);
      }
    }

    out.push(r);
  }

  stats.output = out.length;
  return { records: out, stats };
}

/**
 * The cheap bucket key. Everything in it must match exactly for two records to
 * even be compared; `sameProduct` then does the pairwise work on what is left,
 * which is a handful of records per bucket.
 *
 * Returns null for records this stage must not touch: no brand (generic USDA
 * ingredients, where "same brand" means nothing) or no serving weight (nothing
 * to align the two panels on).
 *
 * @param {number} shard @param {import('./record.mjs').CanonicalRecord} r
 */
function clusterKey(shard, r) {
  const brand = brandKey(r.brand);
  if (!brand) return null;
  if (r.servingGrams == null || !(r.servingGrams > 0)) return null;
  return [
    shard,
    brand,
    r.basis,
    Math.round(r.servingGrams),
    flavourSignature(r.rawName),
    variantSignature(r.rawName),
  ].join('|');
}

/**
 * Final check before merging two rows that landed in the same bucket.
 * @param {import('./record.mjs').CanonicalRecord|undefined} a
 * @param {import('./record.mjs').CanonicalRecord} b
 */
function sameProduct(a, b) {
  if (!a) return false;
  if (!macrosAgree(a, b)) return false;
  // The bucket key already guarantees the two flavour signatures are equal, so
  // it is enough to know whether that shared signature is empty.
  const flavoured = flavourSignature(a.rawName) !== '';
  return identityCompatible(identityTokens(a.rawName), identityTokens(b.rawName), { flavoured });
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

  // Keep the loser's barcode pointing at the keeper.
  //
  // Until the product-cluster rule there was no dedupe path that discarded a
  // *distinct* GTIN: the GTIN path merges equal barcodes and the fingerprint
  // path merges barcodeless records. Clustering three regional SKUs of one tub
  // is the first step that could quietly break scanning two of them — fixing a
  // search problem by regressing a different feature.
  //
  // It is also the attribution question. OFF's terms ask re-users to credit
  // contributors with a link to the product they contributed to (NOTICE.md
  // §2.2); dropping the barcodes of the rows we folded in would drop exactly
  // those links. Retaining them keeps every contributed product reachable.
  //
  // The barcode table is a flat sorted (gtin -> record) list, so an extra entry
  // costs about four bytes and needs no format change.
  // Note the loser's ALREADY-ABSORBED barcodes move too. Merges chain — A
  // absorbs B, then C absorbs A — and a version of this that copied only
  // `loser.gtin` silently dropped B's barcode at the second hop. Four SKUs of
  // the Gold Standard tub merge in the full corpus and exactly one of them
  // stopped scanning, which is the kind of hole a spot check does not find.
  const incoming = [
    ...(loser.gtin != null ? [{ value: loser.gtin, digits: loser.gtinDigits ?? String(loser.gtin).length }] : []),
    ...(loser.extraGtins ?? []),
  ];
  if (incoming.length > 0) {
    const extras = (keeper.extraGtins ??= []);
    for (const g of incoming) {
      if (g.value !== keeper.gtin && !extras.some((e) => e.value === g.value)) extras.push(g);
    }
  }

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
