import assert from 'node:assert/strict';
import test from 'node:test';

import { FoodIndex } from '../../src/reader.mjs';
import { tokenise } from '../../src/text.mjs';
import { SHARD, SOURCE } from '../../src/schema.mjs';
import { encodeBarcodes, encodeRecords, encodeSearch } from '../lib/encode.mjs';
import { quantise } from '../lib/nutrients.mjs';

/** @returns {import('../lib/record.mjs').CanonicalRecord} */
function rec(over = {}) {
  return {
    source: SOURCE.USDA_FOUNDATION,
    sourceId: '1',
    name: 'Chicken breast',
    rawName: 'Chicken, breast',
    brand: null,
    gtin: null,
    basis: 'g',
    n: quantise({
      kcal: 165,
      proteinG: 31.02,
      carbG: 0,
      fatG: 3.57,
      fibreG: 0,
      sugarG: 0,
      sodiumMg: 74,
      satFatG: 1.01,
    }),
    servingGrams: 172,
    servingLabel: '1 breast',
    servingEstimated: false,
    atwaterMismatch: false,
    highConfidence: true,
    aliases: [],
    popularity: 0,
    countries: ['us'],
    ...over,
  };
}

const RECORDS = [
  rec(),
  rec({ sourceId: '2', name: 'Chickpeas, cooked', rawName: 'Chickpeas', aliases: ['garbanzo beans'] }),
  rec({
    sourceId: '3',
    name: 'Greek Yogurt, Plain',
    rawName: 'Greek Yogurt',
    brand: 'Fage',
    gtin: 8_710_400_000_015,
    basis: 'ml',
    servingEstimated: true,
  }),
  rec({ sourceId: '4', name: 'Crème Fraîche', rawName: 'Crème Fraîche', brand: 'Président' }),
  rec({ sourceId: '5', name: 'Milkshake, chocolate', rawName: 'Milkshake', gtin: 12_345_678_905 }),
  rec({ sourceId: '6', name: 'Milk, whole', rawName: 'Milk', servingGrams: null, servingLabel: null }),
];

function build(records = RECORDS) {
  return new FoodIndex({
    records: encodeRecords(records, SHARD.CORE),
    search: encodeSearch(records, SHARD.CORE),
    barcodes: encodeBarcodes(records, SHARD.CORE),
  });
}

test('every record round-trips field for field', () => {
  const idx = build();
  assert.equal(idx.length, RECORDS.length);
  RECORDS.forEach((src, i) => {
    const got = idx.get(i);
    assert.ok(got, `record ${i} missing`);
    assert.equal(got.name, src.name);
    assert.equal(got.brand, src.brand);
    assert.equal(got.sourceId, src.sourceId);
    assert.equal(got.basis, src.basis);
    assert.equal(got.servingGrams, src.servingGrams);
    assert.equal(got.servingLabel, src.servingLabel);
    assert.equal(got.flags.servingEstimated, src.servingEstimated);
    assert.equal(got.flags.hasBarcode, src.gtin != null);
    assert.deepEqual(got.per100, src.n);
  });
});

test('out-of-range ids return null rather than throwing', () => {
  const idx = build();
  assert.equal(idx.get(-1), null);
  assert.equal(idx.get(RECORDS.length), null);
  assert.equal(idx.get(1.5), null);
});

test('exact and prefix search both hit', () => {
  const idx = build();
  assert.equal(idx.search('chicken')[0]?.food.sourceId, '1');
  assert.equal(idx.search('chick')[0]?.food.sourceId, '1', 'prefix expands to chicken and chickpeas');
  assert.ok(idx.search('chick').length >= 2);
  // "milk" must outrank "milkshake" for the query "milk".
  assert.equal(idx.search('milk')[0]?.food.name, 'Milk, whole');
});

test('multi-token queries intersect', () => {
  const idx = build();
  const hits = idx.search('greek yog');
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.food.sourceId, '3');
  assert.equal(idx.search('greek chicken').length, 0);
});

test('brand and alias fields are searchable', () => {
  const idx = build();
  assert.equal(idx.search('fage')[0]?.food.sourceId, '3');
  assert.equal(idx.search('garbanzo')[0]?.food.sourceId, '2');
});

test('diacritics fold both ways', () => {
  const idx = build();
  assert.equal(idx.search('creme')[0]?.food.name, 'Crème Fraîche');
  assert.equal(idx.search('crème')[0]?.food.name, 'Crème Fraîche');
  assert.equal(idx.search('president')[0]?.food.brand, 'Président');
});

test('barcode lookup is exact', () => {
  const idx = build();
  assert.equal(idx.byBarcode('8710400000015')?.sourceId, '3');
  assert.equal(idx.byBarcode(12_345_678_905)?.sourceId, '5');
  assert.equal(idx.byBarcode('0000000000000'), null);
  assert.equal(idx.byBarcode('9999999999999'), null);
  assert.equal(idx.byBarcode('not a barcode'), null);
});

test('barcode lookup survives crossing a checkpoint boundary', () => {
  // 400 synthetic barcodes forces several BARCODE_SKIP_INTERVAL checkpoints.
  const many = Array.from({ length: 400 }, (_, i) =>
    rec({ sourceId: `b${i}`, name: `Product ${i}`, gtin: 1_000_000_000_000 + i * 7 }),
  );
  const idx = build(many);
  for (const probe of [0, 1, 127, 128, 129, 255, 256, 399]) {
    assert.equal(
      idx.byBarcode(1_000_000_000_000 + probe * 7)?.sourceId,
      `b${probe}`,
      `probe ${probe}`,
    );
  }
  assert.equal(idx.byBarcode(1_000_000_000_001), null, 'a gap between GTINs is a miss');
});

test('attribution url is emitted for every OFF record', () => {
  const off = [rec({ source: SOURCE.OFF, sourceId: '3017620422003', gtin: 3_017_620_422_003 })];
  const idx = new FoodIndex({
    records: encodeRecords(off, SHARD.OFF),
    search: encodeSearch(off, SHARD.OFF),
    barcodes: encodeBarcodes(off, SHARD.OFF),
  });
  const food = idx.get(0);
  assert.equal(food?.shard, 'off');
  assert.equal(food?.licence, 'ODbL-1.0');
  assert.equal(food?.attributionUrl, 'https://world.openfoodfacts.org/product/3017620422003');
});

test('an empty query returns nothing rather than everything', () => {
  const idx = build();
  assert.deepEqual(idx.search(''), []);
  assert.deepEqual(idx.search('   '), []);
  assert.deepEqual(idx.search('zzzzz'), []);
});

test('a name that opens with a stopword is still findable by its real term', () => {
  // "The Madelaine Chocolate Company" and "De Nigris" are real records from the
  // OFF sample. Their first display word is a stopword and is deliberately not
  // indexed; the query path folds identically, so a user typing "de nigris"
  // searches for `nigris` and finds it. verify-index.mjs probes by first
  // INDEXED term for exactly this reason.
  const records = [
    rec({ sourceId: 's1', name: 'The Madelaine Chocolate Company, Solid Milk Chocolate' }),
    rec({ sourceId: 's2', name: 'De Nigris, Balsamic Glaze' }),
  ];
  const idx = new FoodIndex({
    records: encodeRecords(records, SHARD.OFF),
    search: encodeSearch(records, SHARD.OFF),
    barcodes: encodeBarcodes(records, SHARD.OFF),
  });
  assert.equal(idx.search('madelaine')[0]?.food.sourceId, 's1');
  assert.equal(idx.search('de nigris')[0]?.food.sourceId, 's2', 'the stopword in the query folds away too');
  assert.equal(idx.search('nigris')[0]?.food.sourceId, 's2');
  assert.deepEqual(idx.search('the'), [], 'the stopword itself indexes nothing, by design');
});

test('a name made only of stopwords has no indexable term', () => {
  // The genuine unfindable case. verify-index.mjs fails the build on these;
  // this test pins the condition it detects.
  assert.deepEqual(tokenise('The'), []);
  assert.deepEqual(tokenise('De La'), []);
  assert.ok(tokenise('The Original Macaroon').length > 0, 'but only when nothing else is left');
});
