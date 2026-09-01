/**
 * The product-cluster dedupe, pinned against the real records that motivated it.
 *
 * Every record below is copied from the shipped 2026.08.1 OFF shard, values and
 * all. That matters: a fixture invented to make the rule look right proves
 * nothing about the corpus, and this rule exists because three real rows for one
 * tub of whey reached a real user.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { SHARD, SOURCE } from '../../src/schema.mjs';
import { FoodIndex } from '../../src/reader.mjs';
import { dedupe } from '../lib/dedupe.mjs';
import { encodeBarcodes, encodeRecords, encodeSearch } from '../lib/encode.mjs';
import { rankAll } from '../lib/rank.mjs';
import {
  brandKey,
  flavourSignature,
  identityCompatible,
  identityTokens,
  macrosAgree,
  representativeScore,
  variantSignature,
} from '../lib/variants.mjs';

/**
 * @param {string} sourceId @param {string|null} brand @param {string} name
 * @param {number|null} servingGrams @param {string|null} servingLabel
 * @param {Partial<import('../lib/nutrients.mjs').Nutrients>} n
 * @param {Partial<import('../lib/record.mjs').CanonicalRecord>} [over]
 * @returns {import('../lib/record.mjs').CanonicalRecord}
 */
const off = (sourceId, brand, name, servingGrams, servingLabel, n, over = {}) => ({
  source: SOURCE.OFF,
  sourceId,
  name,
  rawName: name,
  brand,
  gtin: Number(sourceId),
  gtinDigits: sourceId.length,
  basis: 'g',
  n: { kcal: 0, proteinG: 0, carbG: 0, fatG: 0, fibreG: 0, sugarG: 0, sodiumMg: 0, satFatG: 0, ...n },
  servingGrams,
  servingLabel,
  servingEstimated: false,
  atwaterMismatch: false,
  energyReported: true,
  energyDerived: false,
  highConfidence: true,
  aliases: [],
  popularity: 0,
  countries: ['united-states'],
  ...over,
});

// ── the three real Gold Standard vanilla rows, verbatim from the shard ──────
const GS_LOWERCASE = off(
  '0748927065701',
  'optimum nutrition',
  'gold standard whey protein- vanilla ice cream flavor',
  31,
  '1 scoop',
  { kcal: 394, proteinG: 77.4, carbG: 12.9, fatG: 2.9, sugarG: 2.9, sodiumMg: 329, satFatG: 2 },
);
const GS_PORTION = off(
  '0748927065954',
  'Optimum Nutrition',
  'Gold Standard 100% Whey Vanilla Flavour',
  31,
  '1 portion',
  { kcal: 406, proteinG: 77.4, carbG: 12.9, fatG: 4.84, sugarG: 3.23, sodiumMg: 419, satFatG: 3 },
);
const GS_BEST = off(
  '0748927065794',
  'Optimum Nutrition',
  'Gold Standard Whey (Vanilla Ice Cream Flavour)',
  31,
  '1 scoop',
  { kcal: 387, proteinG: 77, carbG: 13, fatG: 3, sugarG: 3, sodiumMg: 323, satFatG: 2 },
);

test('the three Gold Standard vanilla rows collapse to one', () => {
  const { records, stats } = dedupe(rankAll([GS_LOWERCASE, GS_PORTION, GS_BEST]));
  assert.equal(records.length, 1, 'three transcriptions of one tub must ship as one row');
  assert.equal(stats.byProductCluster, 2);
});

test('the survivor is the row a user should be shown', () => {
  const { records } = dedupe(rankAll([GS_LOWERCASE, GS_PORTION, GS_BEST]));
  const [kept] = records;
  assert.ok(kept);

  // "1 scoop" over "1 portion": a scoop is a thing in the tub, a portion is a
  // restatement of the word serving.
  assert.match(/** @type {string} */ (kept.servingLabel), /scoop/i);
  // A name written like a product name, not pasted from a spreadsheet.
  assert.equal(kept.name, 'Gold Standard Whey (Vanilla Ice Cream Flavour)');
  assert.equal(kept.brand, 'Optimum Nutrition');

  // And what the user actually reads on the portion sheet.
  const perServing = (/** @type {number} */ v) => (v * /** @type {number} */ (kept.servingGrams)) / 100;
  assert.equal(Math.round(perServing(kept.n.kcal)), 120);
  assert.equal(Math.round(perServing(kept.n.proteinG) * 10) / 10, 23.9);
});

test('the losing rows survive as aliases, so their wording is still searchable', () => {
  const { records } = dedupe(rankAll([GS_LOWERCASE, GS_PORTION, GS_BEST]));
  const aliases = /** @type {string[]} */ (records[0]?.aliases).map((a) => a.toLowerCase());
  assert.ok(
    aliases.some((a) => a.includes('100% whey vanilla')),
    'someone typing the other row\'s wording must still land on the survivor',
  );
});

test('the merged SKUs keep their barcodes, so scanning any of them still works', () => {
  // The cluster rule is the first dedupe path that discards a *distinct* GTIN.
  // Losing those would fix a search problem by silently breaking barcode scan
  // for two of the three SKUs — and, on the OFF shard, would drop the
  // per-product attribution links OFF's terms ask for (NOTICE.md §2.2).
  const { records } = dedupe(rankAll([GS_LOWERCASE, GS_PORTION, GS_BEST]));
  const [kept] = records;
  assert.ok(kept);
  const carried = new Set([
    String(kept.gtin),
    ...(kept.extraGtins ?? []).map((g) => String(g.value)),
  ]);
  for (const r of [GS_LOWERCASE, GS_PORTION, GS_BEST]) {
    assert.ok(carried.has(String(r.gtin)), `barcode ${r.sourceId} must still resolve`);
  }
});

test('a merged barcode resolves to the surviving record through the real encoder', () => {
  const { records } = dedupe(rankAll([GS_LOWERCASE, GS_PORTION, GS_BEST]));
  const idx = new FoodIndex({
    records: encodeRecords(records, SHARD.OFF),
    search: encodeSearch(records, SHARD.OFF),
    barcodes: encodeBarcodes(records, SHARD.OFF),
  });
  for (const r of [GS_LOWERCASE, GS_PORTION, GS_BEST]) {
    const hit = idx.byBarcode(String(r.gtin));
    assert.ok(hit, `scanning ${r.sourceId} returned nothing`);
    assert.equal(hit.sourceId, '0748927065794', 'every SKU must reach the row we kept');
  }
});

test('barcodes survive a merge that chains through several rows', () => {
  // Regression. Merges chain: A absorbs B, then C absorbs A. A version of
  // `absorb` that moved only the loser's own GTIN dropped B's barcode at the
  // second hop — and in the real corpus four Gold Standard SKUs merge, so
  // exactly one of them quietly stopped scanning.
  const fourth = off(
    '0748927054545',
    'Optimum Nutrition',
    'Gold Standard Whey Vanilla Ice Cream',
    31,
    '1 serving',
    { kcal: 390, proteinG: 77.2, carbG: 12.8, fatG: 3.1, sugarG: 3, sodiumMg: 330, satFatG: 2 },
  );
  const all = [GS_LOWERCASE, GS_PORTION, GS_BEST, fourth];
  const { records } = dedupe(rankAll([...all]));
  assert.equal(records.length, 1);

  const idx = new FoodIndex({
    records: encodeRecords(records, SHARD.OFF),
    search: encodeSearch(records, SHARD.OFF),
    barcodes: encodeBarcodes(records, SHARD.OFF),
  });
  for (const r of all) {
    assert.equal(
      idx.byBarcode(String(r.gtin))?.sourceId,
      '0748927065794',
      `scanning ${r.sourceId} must reach the surviving row`,
    );
  }
});

// ── the guard: a wrong merge is far worse than a surviving duplicate ────────

test('different flavours of one product never merge', () => {
  // Real rows. Same brand, same 31 g scoop, macros within a few percent —
  // everything the tolerance looks at agrees. Only the flavour differs.
  const chocolate = off(
    '0748927068801',
    'Optimum Nutrition',
    'Double Rich Chocolate Gold Standard Whey Protein Powder',
    30.4,
    '1 scoop',
    { kcal: 401, proteinG: 78.9, carbG: 9.87, fatG: 4.93, sugarG: 3.29, sodiumMg: 428, satFatG: 3.5 },
  );
  const { records } = dedupe(rankAll([GS_BEST, chocolate]));
  assert.equal(records.length, 2, 'vanilla and chocolate whey must both ship');
});

test('different formulations of one product line never merge', () => {
  const isolate = off(
    '0748927071931',
    'Optimum Nutrition',
    'Optimum Nutrition Gold Standard 100% Isolate',
    31,
    '1 portion',
    { kcal: 354, proteinG: 80.6, carbG: 6.45, fatG: 0, sugarG: 3.23, sodiumMg: 668 },
  );
  const casein = off('0748927024159', 'Optimum Nutrition', 'Gold standard casein', 33, '1 scoop', {
    kcal: 333,
    proteinG: 72.7,
    carbG: 9.09,
    fatG: 1.52,
    sugarG: 6.06,
    sodiumMg: 727,
  });
  const { records } = dedupe(rankAll([GS_BEST, isolate, casein]));
  assert.equal(records.length, 3, 'whey, isolate and casein are three products');
});

test('an unflavoured listing is not absorbed into a flavoured one', () => {
  // The dangerous shape: a generic row whose tokens are a strict subset of a
  // flavoured row's. Containment alone would fold it in and the user would log
  // vanilla whey believing they logged the plain tub.
  const plain = off('0748927054453', 'OPTIMUM NUTRITION', 'Gold Standard 100% Whey', 31, '1 scoop', {
    kcal: 387,
    proteinG: 77,
    carbG: 13,
    fatG: 3,
    sugarG: 3,
    sodiumMg: 323,
    satFatG: 2,
  });
  const { records } = dedupe(rankAll([GS_BEST, plain]));
  assert.equal(records.length, 2);
});

test('an unenumerated flavour word blocks a merge rather than being ignored', () => {
  // Regression, and the reason containment is an allow-list. The first version
  // of this rule merged these two: "pepperoncini" is a flavour no vocabulary
  // enumerates, so the plain row's tokens were a subset of the flavoured one's.
  const plain = off('0084114127570', 'Kettle', 'Potato Chips', 28, '1 ONZ', {
    kcal: 500,
    proteinG: 7.14,
    carbG: 57.1,
    fatG: 28.6,
    sodiumMg: 1070,
    satFatG: 2.5,
  });
  const flavoured = off('0084114127571', 'Kettle', 'Potato Chips Pepperoncini', 28, '13 chips', {
    kcal: 500,
    proteinG: 7.14,
    carbG: 57.1,
    fatG: 28.6,
    sodiumMg: 1070,
    satFatG: 2.5,
  });
  const { records } = dedupe(rankAll([plain, flavoured]));
  assert.equal(records.length, 2, 'an unknown extra token must block, not be waved through');
});

test('a size difference blocks a merge', () => {
  const large = off('0000000000011', 'Sunny Queen Farms', 'Cage Free Large Eggs', 104, '2 egg', {
    kcal: 142,
    proteinG: 12.5,
    carbG: 0.96,
    fatG: 9.62,
    sodiumMg: 135,
  });
  const xLarge = off('0000000000012', 'Sunny Queen Farms', 'X-Large Eggs', 104, '2 eggs', {
    kcal: 142,
    proteinG: 12.5,
    carbG: 0.96,
    fatG: 9.62,
    sodiumMg: 135,
  });
  const { records } = dedupe(rankAll([large, xLarge]));
  assert.equal(records.length, 2);
});

test('records from different shards are never clustered together', () => {
  // The licence invariant, restated at this stage: the cluster rule must not be
  // the thing that finally merges an OFF value into the public-domain shard.
  const usda = {
    ...GS_BEST,
    source: SOURCE.USDA_BRANDED,
    sourceId: '2000001',
    gtin: 748927065794,
  };
  const { records } = dedupe(rankAll([usda, { ...GS_BEST, gtin: 748927065795 }]));
  assert.equal(records.length, 2, 'a cross-shard pair must stay two records');
});

// ── the pieces, so a failure above points somewhere ────────────────────────

test('brand keys survive casing and corporate suffixes', () => {
  assert.equal(brandKey('OPTIMUM NUTRITION'), brandKey('Optimum Nutrition'));
  assert.equal(brandKey('optimum nutrition'), brandKey('Optimum nutrition'));
  assert.equal(brandKey('Good Society Food Co.'), brandKey('Good Society'));
  assert.equal(brandKey(null), '');
});

test('flavour signatures reduce a flavour name to its head, and fold plurals', () => {
  assert.equal(flavourSignature('Double Rich Chocolate'), 'chocolate');
  assert.equal(flavourSignature('Extreme Milk Chocolate'), 'chocolate');
  assert.equal(flavourSignature('Strawberries & Cream'), 'strawberry');
  // "ice" and "cream" are modifiers, not heads — that is what lets the same
  // vanilla tub be written two ways.
  assert.equal(
    flavourSignature('Gold Standard 100% Whey Vanilla Flavour'),
    flavourSignature('Gold Standard Whey (Vanilla Ice Cream Flavour)'),
  );
  assert.equal(flavourSignature('Potato Chips'), '');
});

test('variant signatures separate formulations', () => {
  assert.notEqual(variantSignature('Gold Standard Whey'), variantSignature('Gold Standard Isolate'));
  // "Protein" and "Powder" are generic descriptors, not formulations.
  assert.equal(variantSignature('Whey Protein Powder'), variantSignature('Whey'));
});

test('identity containment needs a named flavour and only modifier extras', () => {
  const short = identityTokens('Gold Standard 100% Whey Vanilla Flavour');
  const long = identityTokens('Gold Standard Whey (Vanilla Ice Cream Flavour)');
  assert.equal(identityCompatible(short, long, { flavoured: true }), true);
  assert.equal(
    identityCompatible(short, long, { flavoured: false }),
    false,
    'without a named flavour, containment is not evidence of the same product',
  );
  assert.equal(
    identityCompatible(identityTokens('Potato Chips'), identityTokens('Potato Chips Pepperoncini'), {
      flavoured: true,
    }),
    false,
    'an extra token outside the modifier list must block even when flavoured',
  );
  assert.equal(identityCompatible(new Set(), long, { flavoured: true }), false);
});

test('macro tolerance absorbs label rounding but not a real difference', () => {
  assert.equal(macrosAgree(GS_BEST, GS_PORTION), true, '387 vs 406 kcal is label rounding');
  assert.equal(macrosAgree(GS_BEST, GS_LOWERCASE), true);
  const isolate = { ...GS_BEST, n: { ...GS_BEST.n, kcal: 354, proteinG: 80.6, carbG: 6.45, fatG: 0 } };
  assert.equal(macrosAgree(GS_BEST, isolate), false, '13 g vs 6.45 g of carbohydrate is a different product');
});

test('the representative score prefers a countable serving over a generic one', () => {
  assert.ok(
    representativeScore(GS_BEST) > representativeScore(GS_PORTION),
    '"1 scoop" must beat "1 portion"',
  );
  assert.ok(
    representativeScore(GS_BEST) > representativeScore(GS_LOWERCASE),
    'a name written like a product name must beat a lowercase paste',
  );
});
