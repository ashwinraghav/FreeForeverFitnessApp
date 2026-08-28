import assert from 'node:assert/strict';
import test from 'node:test';

import { ByteWriter } from '../../src/bytes.mjs';
import { fingerprint, fold, tokenise } from '../../src/text.mjs';
import { atwaterKcal, parseServing, quantise, toPer100, validate } from '../lib/nutrients.mjs';
import { FIELDS, mapProduct } from '../sources/off.mjs';
import { mapFood, normaliseGtin } from '../sources/usda.mjs';

/** @param {object} over */
const n = (over) => ({
  kcal: 0,
  proteinG: 0,
  carbG: 0,
  fatG: 0,
  fibreG: 0,
  sugarG: 0,
  sodiumMg: 0,
  satFatG: 0,
  ...over,
});

test('a writer created with zero capacity grows instead of spinning', () => {
  // Regression: `cap = buf.length * 2` never escapes 0, so an empty shard hung
  // the encoder in an infinite loop rather than producing an empty artefact.
  const w = new ByteWriter(0);
  w.varint(0).varint(300).str('hello');
  assert.ok(w.finish().length > 5);
});

test('varints round-trip values past 2^32, which GTINs need', () => {
  const w = new ByteWriter(4);
  for (const v of [0, 1, 127, 128, 16_383, 16_384, 12_345_678_905, 9_999_999_999_999]) w.varint(v);
  assert.ok(w.finish().length > 0);
  assert.throws(() => new ByteWriter().varint(-1), RangeError);
  assert.throws(() => new ByteWriter().varint(1.5), RangeError);
});

test('tokenisation drops stopwords and one-letter noise but keeps digits', () => {
  assert.deepEqual(tokenise('Cup of Tea'), ['cup', 'tea']);
  assert.deepEqual(tokenise('2% Milk, a Pint'), ['2', 'milk', 'pint']);
  assert.equal(fold("Hershey's"), 'hersheys');
  assert.equal(fingerprint('Yogurt, Greek, Plain'), fingerprint('Plain Greek Yogurt'));
});

test('per-serving nutrients rescale to per 100 g', () => {
  const perServing = n({ kcal: 100, proteinG: 5 });
  const per100 = toPer100(perServing, 50);
  assert.equal(per100.kcal, 200);
  assert.equal(per100.proteinG, 10);
  assert.throws(() => toPer100(perServing, 0), RangeError);
});

test('serving sizes parse, and volumes are flagged as estimated', () => {
  assert.deepEqual(parseServing('30 g'), { grams: 30, estimated: false, basis: 'g' });
  assert.deepEqual(parseServing('1 oz'), { grams: 28.349523125, estimated: false, basis: 'g' });
  const cup = parseServing('240 ml');
  assert.equal(cup?.grams, 240);
  assert.equal(cup?.estimated, true, 'a volume-to-mass conversion must be marked estimated');
  assert.equal(parseServing('a handful'), null);
  assert.equal(parseServing(null), null);
});

test('validation rejects impossible records', () => {
  assert.equal(validate(n({ kcal: 5000 })).ok, false);
  assert.equal(validate(n({ kcal: 100, fatG: 200 })).ok, false);
  assert.equal(validate(n({ kcal: 100, proteinG: 50, carbG: 50, fatG: 50 })).ok, false);
  assert.equal(validate(n({ kcal: 100, fatG: 1, satFatG: 10 })).ok, false);
  assert.equal(validate(n({ kcal: -1 })).ok, false);
});

test('a missing energy field is dropped but a stated zero is kept', () => {
  // The whole point of the ENERGY_REPORTED flag: identical numbers, opposite
  // meanings. Bread with no energy field is broken data; diet soda is not.
  assert.equal(validate(n({ sodiumMg: 420 })).ok, false, 'bread with only sodium is missing data');
  assert.equal(
    validate(n({ sodiumMg: 15 }), { energyReported: true }).ok,
    true,
    'sparkling water that states 0 kcal is a real food',
  );
});

test('atwater mismatch is flagged, not silently repaired', () => {
  const consistent = n({ kcal: 165, proteinG: 31, fatG: 3.6 });
  const result = validate(consistent);
  assert.equal(result.ok && result.atwaterMismatch, false);

  const inconsistent = n({ kcal: 400, proteinG: 1, carbG: 1, fatG: 1 });
  const bad = validate(inconsistent);
  assert.equal(bad.ok, true, 'still usable');
  assert.equal(bad.ok && bad.atwaterMismatch, true, 'but flagged');
  assert.equal(inconsistent.kcal, 400, 'the stated value is left alone');
  assert.ok(atwaterKcal(inconsistent) < 30);
});

test('quantisation stays within the stored precision', () => {
  const q = quantise(n({ kcal: 165.7, proteinG: 31.024, satFatG: 1.3 }));
  assert.equal(q.kcal, 166);
  assert.equal(q.proteinG, 31.02);
  assert.equal(q.satFatG, 1.5, 'saturated fat is stored in half-grams');
});

test('GTIN parsing keeps the digit count so leading zeros survive', () => {
  assert.deepEqual(normaliseGtin('0012345678905'), { value: 12345678905, digits: 13 });
  assert.deepEqual(normaliseGtin('012345678905'), { value: 12345678905, digits: 12 });
  assert.equal(normaliseGtin('123'), null);
  assert.equal(normaliseGtin(null), null);
});

test('USDA nutrients map from all three response shapes', () => {
  const base = { fdcId: 1, description: 'Test food', dataType: 'Foundation' };
  const byNumber = mapFood({ ...base, foodNutrients: [{ number: '208', amount: 100 }, { number: '203', amount: 10 }] });
  const byId = mapFood({ ...base, foodNutrients: [{ nutrientId: 1008, value: 100 }, { nutrientId: 1003, value: 10 }] });
  const byNested = mapFood({ ...base, foodNutrients: [{ nutrient: { id: 1008 }, amount: 100 }, { nutrient: { id: 1003 }, amount: 10 }] });
  for (const [label, r] of [['number', byNumber], ['id', byId], ['nested', byNested]]) {
    assert.equal(r?.n.kcal, 100, `${label} shape energy`);
    assert.equal(r?.n.proteinG, 10, `${label} shape protein`);
  }
});

test('OFF sodium is read as grams and converted to milligrams', () => {
  // The single most dangerous unit in either upstream: getting this wrong is a
  // 1000x error on a nutrient people actively track.
  const r = mapProduct({
    code: '3017620422003',
    product_name: 'Test spread',
    nutriments: { 'energy-kcal_100g': 500, proteins_100g: 6, sodium_100g: 0.107 },
  });
  assert.equal(r?.n.sodiumMg, 107);
});

test('OFF salt is converted to sodium when sodium is absent', () => {
  const r = mapProduct({
    code: '3017620422003',
    product_name: 'Salty thing',
    nutriments: { 'energy-kcal_100g': 100, salt_100g: 2.5 },
  });
  assert.equal(r?.n.sodiumMg, 1000, '2.5 g salt is 1 g sodium');
});

test('OFF energy falls back from kcal to kJ', () => {
  const r = mapProduct({
    code: '3017620422003',
    product_name: 'kJ only',
    nutriments: { 'energy-kj_100g': 418.4, proteins_100g: 1 },
  });
  assert.equal(r?.n.kcal, 100);
});

test('an OFF product without a barcode is dropped, because it cannot be credited', () => {
  const r = mapProduct({
    product_name: 'No barcode',
    nutriments: { 'energy-kcal_100g': 100, proteins_100g: 5 },
  });
  assert.equal(r, null);
});

test('no image field survives the OFF field allow-list', () => {
  // CC-BY-SA product photos must not enter the pipeline at all (NOTICE.md
  // §2.5). Two gates: FIELDS is the allow-list the dump reader projects
  // through, and mapProduct only reads named fields.
  assert.ok(
    !FIELDS.some((f) => /image/i.test(f)),
    'an image field in the allow-list would be a licence violation, not a size regression',
  );

  const r = mapProduct({
    code: '3017620422003',
    product_name: 'Chocolate spread',
    image_url: 'https://example.invalid/front.jpg',
    image_front_url: 'https://example.invalid/front2.jpg',
    selected_images: { front: { display: { en: 'https://example.invalid/x.jpg' } } },
    nutriments: { 'energy-kcal_100g': 100, proteins_100g: 5 },
  });
  assert.ok(r);
  const keys = new Set(collectKeys(r));
  assert.ok(![...keys].some((k) => /image/i.test(k)), 'no image-shaped key reaches a canonical record');
  assert.ok(!JSON.stringify(r).includes('example.invalid'), 'no image URL is carried through');
});

/** @param {unknown} v @returns {string[]} */
function collectKeys(v) {
  if (v === null || typeof v !== 'object') return [];
  if (Array.isArray(v)) return v.flatMap(collectKeys);
  return Object.entries(v).flatMap(([k, child]) => [k, ...collectKeys(child)]);
}

test('energy is derived from the macros when upstream left it out', () => {
  // USDA ships a surprising number of records with macros and no energy field.
  // Anchovies canned in oil: 26.9 g protein, 9.85 g fat, 2.41 g carb, no 208.
  const anchovies = mapFood({
    fdcId: 1,
    description: 'Anchovies, canned in olive oil, drained',
    dataType: 'Foundation',
    foodNutrients: [
      { number: '203', amount: 26.9 },
      { number: '204', amount: 9.85 },
      { number: '205', amount: 2.41 },
    ],
  });
  assert.ok(anchovies);
  assert.equal(anchovies.energyReported, false);
  assert.equal(anchovies.energyDerived, true);
  // USDA's published figure for this food is ~210 kcal.
  assert.ok(anchovies.n.kcal > 190 && anchovies.n.kcal < 220, `got ${anchovies.n.kcal}`);
});

test('a stated zero that the macros contradict is also derived', () => {
  // OFF contributors fill in macros and leave energy at 0 often enough that
  // trusting the stated zero ships real foods showing 0 kcal.
  const r = mapProduct({
    code: '3017620422003',
    product_name: 'Contradictory',
    nutriments: { 'energy-kcal_100g': 0, proteins_100g: 20, fat_100g: 10, carbohydrates_100g: 5 },
  });
  assert.equal(r?.energyDerived, true);
  assert.equal(r?.n.kcal, 190);
});

test('a genuine zero-calorie food is left at zero', () => {
  const soda = mapProduct({
    code: '3017620422003',
    product_name: 'Diet soda',
    nutriments: { 'energy-kcal_100g': 0, proteins_100g: 0, fat_100g: 0, carbohydrates_100g: 0, sodium_100g: 0.015 },
  });
  assert.ok(soda, 'a stated zero-calorie food still ships');
  assert.equal(soda.n.kcal, 0);
  assert.equal(soda.energyDerived, false);
  assert.equal(soda.energyReported, true);
});
