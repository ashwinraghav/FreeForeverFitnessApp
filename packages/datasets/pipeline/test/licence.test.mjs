/**
 * The licence invariants from NOTICE.md, as tests.
 *
 * These are the checks that stop a plausible-looking refactor from creating an
 * ODbL violation. They are not about correctness of output; they are about
 * whether we are allowed to ship it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { SHARD, SOURCE, SOURCE_SHARD } from '../../src/schema.mjs';
import { dedupe } from '../lib/dedupe.mjs';
import { rankAll } from '../lib/rank.mjs';
import { shardOf } from '../lib/record.mjs';
import { productUrl } from '../sources/off.mjs';

/** @returns {import('../lib/record.mjs').CanonicalRecord} */
function rec(over = {}) {
  return {
    source: SOURCE.USDA_BRANDED,
    sourceId: 'x',
    name: 'Thing',
    rawName: 'Thing',
    brand: 'Brand',
    gtin: null,
    gtinDigits: null,
    basis: 'g',
    n: { kcal: 100, proteinG: 5, carbG: 10, fatG: 3, fibreG: 1, sugarG: 2, sodiumMg: 50, satFatG: 1 },
    servingGrams: 30,
    servingLabel: '1 serving',
    servingEstimated: false,
    atwaterMismatch: false,
    energyReported: true,
    highConfidence: true,
    aliases: [],
    popularity: 0,
    countries: ['us'],
    ...over,
  };
}

test('every source maps to exactly one shard', () => {
  for (const code of Object.values(SOURCE)) {
    assert.ok(SOURCE_SHARD[code] !== undefined, `source ${code} has no shard`);
  }
  assert.equal(SOURCE_SHARD[SOURCE.OFF], SHARD.OFF);
  for (const usda of [SOURCE.USDA_FOUNDATION, SOURCE.USDA_SR_LEGACY, SOURCE.USDA_BRANDED]) {
    assert.equal(SOURCE_SHARD[usda], SHARD.CORE);
  }
});

test('an OFF duplicate of a USDA product is suppressed, not merged', () => {
  // NOTICE.md §2.4. Merging would make the public-domain shard a derivative of
  // an ODbL database; suppression is a decision not to copy.
  const usda = rec({ sourceId: 'fdc-1', gtin: 12345678905, gtinDigits: 11, name: 'Cereal' });
  const off = rec({
    source: SOURCE.OFF,
    sourceId: '00012345678905',
    gtin: 12345678905,
    gtinDigits: 14,
    name: 'Cereal',
    aliases: ['OFF-only alias'],
    popularity: 9999,
  });

  const { records, stats } = dedupe(rankAll([usda, off]));
  assert.equal(stats.offSuppressedByCore, 1);
  assert.equal(records.length, 1);

  const kept = records[0];
  assert.equal(shardOf(/** @type {any} */ (kept)), SHARD.CORE);
  assert.ok(
    !kept?.aliases.includes('OFF-only alias'),
    'no OFF-derived value may reach a core record, not even an alias',
  );
  assert.equal(kept?.popularity, 0, 'nor an OFF popularity signal');
});

test('duplicates within a shard do merge', () => {
  const a = rec({ sourceId: 'a', rawName: 'Greek Yogurt', name: 'Greek Yogurt', servingGrams: null, servingLabel: null });
  const b = rec({ sourceId: 'b', rawName: 'Greek Yogurt', name: 'Greek Yogurt', aliases: ['Yoghurt'] });
  const { records, stats } = dedupe(rankAll([a, b]));
  assert.equal(records.length, 1);
  assert.equal(stats.byFingerprint, 1);
  assert.ok(records[0]?.aliases.includes('Yoghurt'));
  assert.equal(records[0]?.servingGrams, 30, 'a serving size is worth taking from a duplicate');
});

test('two records with the same name but different nutrients are not merged', () => {
  const raw = rec({ sourceId: 'raw', rawName: 'Chicken breast', n: { ...rec().n, kcal: 120 } });
  const fried = rec({ sourceId: 'fried', rawName: 'Chicken breast', n: { ...rec().n, kcal: 260, fatG: 15 } });
  const { records } = dedupe(rankAll([raw, fried]));
  assert.equal(records.length, 2);
});

test('the OFF product URL is exactly what the terms require', () => {
  assert.equal(
    productUrl('3017620422003'),
    'https://world.openfoodfacts.org/product/3017620422003',
  );
});

test('ranking is deterministic across runs', () => {
  // The integrity hash is meaningless if two builds over identical input can
  // disagree about record order.
  const build = () =>
    rankAll([
      rec({ sourceId: 'b', source: SOURCE.USDA_FOUNDATION }),
      rec({ sourceId: 'a', source: SOURCE.USDA_FOUNDATION }),
      rec({ sourceId: 'c', source: SOURCE.OFF, gtin: 1, gtinDigits: 8 }),
    ]).map((r) => r.sourceId);
  assert.deepEqual(build(), build());
  assert.deepEqual(build(), ['a', 'b', 'c'], 'ties break on the upstream id');
});

test('generic whole foods outrank branded products', () => {
  const ranked = rankAll([
    rec({ sourceId: 'branded', source: SOURCE.USDA_BRANDED, rawName: 'CRUNCHY OAT CLUSTERS, HONEY' }),
    rec({ sourceId: 'generic', source: SOURCE.USDA_FOUNDATION, name: 'Banana', rawName: 'Bananas, raw' }),
  ]);
  assert.equal(ranked[0]?.sourceId, 'generic');
});
