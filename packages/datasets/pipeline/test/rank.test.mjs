/**
 * Ranking tests, and in particular the locale term.
 *
 * These exist because the locale defect was invisible from every direction that
 * mattered: the build ran, the index verified, 91 tests passed, and the term
 * was scoring Australian products as American. Nothing observed it, because
 * nothing asked it a question whose answer it could get wrong.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { SOURCE } from '../../src/schema.mjs';
import { DEFAULT_LOCALE, localeFit, rankAll, score } from '../lib/rank.mjs';
import { gs1Region, regionMix } from '../lib/gs1.mjs';

/** @param {object} over */
const rec = (over) => ({
  sourceId: 'x',
  source: SOURCE.OFF,
  name: 'Product',
  rawName: 'Product',
  brand: 'B',
  gtin: null,
  basis: 'g',
  n: { kcal: 100, proteinG: 5, carbG: 10, fatG: 2, fibreG: 0, sugarG: 0, sodiumMg: 0, satFatG: 0 },
  servingGrams: 30,
  servingLabel: '1 scoop',
  servingEstimated: false,
  atwaterMismatch: false,
  energyReported: true,
  energyDerived: false,
  highConfidence: true,
  aliases: [],
  popularity: 0,
  countries: [],
  ...over,
});

test('a country tag matches its locale by name, not by accident of substring', () => {
  // The defect, named. `'united-states'.includes('us')` is false, so the US
  // build scored every American OFF product as foreign; `'australia'` and
  // `'austria'` do contain `us`, so they were the only OFF rows it ever
  // rewarded. Both directions asserted, because fixing one is not fixing it.
  assert.equal(localeFit({ countries: ['united-states'] }, 'us'), 1);
  assert.equal(localeFit({ countries: ['australia'] }, 'us'), 0.2);
  assert.equal(localeFit({ countries: ['austria'] }, 'us'), 0.2);

  // Same shape, for the locale this index is actually built for. `in` is a
  // substring of all four of these and none of them is India.
  assert.equal(localeFit({ countries: ['india'] }, 'in'), 1);
  for (const c of ['argentina', 'china', 'finland', 'singapore', 'spain', 'ukraine', 'philippines']) {
    assert.equal(localeFit({ countries: [c] }, 'in'), 0.2, `${c} must not read as India`);
  }
});

test('USDA rows carry a bare country code and still match', () => {
  // `sources/usda.mjs` writes `['us']` while OFF writes slugs. A table that
  // only knew about one of the two forms would silently score a whole shard
  // wrong, which is how this went unnoticed for a release.
  assert.equal(localeFit({ countries: ['us'] }, 'us'), 1);
  assert.equal(localeFit({ countries: ['us'] }, 'in'), 0.2);
});

test('a multi-country product matches on any one of its markets', () => {
  // Optimum Nutrition is sold in both countries and OFF tags it accordingly.
  // A locale change must not cost the owner's own acceptance test.
  const on = { countries: ['united-states', 'united-kingdom', 'india', 'canada'] };
  assert.equal(localeFit(on, 'in'), 1);
  assert.equal(localeFit(on, 'us'), 1);
  assert.equal(localeFit(on, 'gb'), 1);
});

test('no country stated scores as unknown, not as foreign', () => {
  assert.equal(localeFit({ countries: [] }, 'in'), 0.5);
  // `en:world` is "nobody filled this in", so it reads the same as blank rather
  // than earning a full local bonus in every build on no evidence.
  assert.equal(localeFit({ countries: ['world'] }, 'in'), 0.5);
  assert.equal(localeFit({ countries: ['world', 'france'] }, 'in'), 0.2);
  assert.equal(localeFit({ countries: ['world', 'india'] }, 'in'), 1);
});

test('a tag namespaced in another language still resolves', () => {
  assert.equal(localeFit({ countries: ['fr:india'] }, 'in'), 1);
});

test('an unknown locale matches its own code and nothing else', () => {
  // The honest degradation: a build for a locale nobody added to the table
  // ranks USDA rows as local and no OFF row as local. Thin, but not wrong, and
  // the build's localeMix report shows it on the first run.
  assert.equal(localeFit({ countries: ['zz'] }, 'zz'), 1);
  assert.equal(localeFit({ countries: ['india'] }, 'zz'), 0.2);
});

test('the locale term can lift an unscanned local product over a popular foreign one', () => {
  // The point of the reweighting, stated as an ordering rather than a number.
  // At 0.05 this assertion failed: the whole term spanned 0.04 and a product
  // with a thousand scans was unreachable by anything a local record could do.
  const local = rec({ sourceId: 'a', countries: ['india'], popularity: 0 });
  const foreign = rec({ sourceId: 'b', countries: ['united-states'], popularity: 1_000 });
  const ctx = { maxPopularity: 100_000, locale: 'in' };
  assert.ok(
    score(local, ctx) > score(foreign, ctx),
    `local ${score(local, ctx).toFixed(3)} should outrank foreign ${score(foreign, ctx).toFixed(3)}`,
  );
});

test('locale ranks but never gates: the foreign record is still in the output', () => {
  // ADR-0030 rule 1. `rankAll` reorders and returns everything it was given;
  // nothing here may drop a record for being foreign. What the 4 MB budget
  // then keeps is a separate decision in `fitToBudget`, and the rest of the
  // corpus ships in the full pack (ADR-0033).
  const input = [
    rec({ sourceId: 'a', countries: ['united-states'] }),
    rec({ sourceId: 'b', countries: ['india'] }),
    rec({ sourceId: 'c', countries: [] }),
  ];
  const out = rankAll(input, { locale: 'in' });
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.map((r) => r.sourceId),
    ['b', 'c', 'a'],
  );
});

test('the top-scoring foreign product still beats a mediocre local one', () => {
  // The other side of the trade, and the guard against a weight so large that
  // locale stops being one term of six. A hugely-scanned global product is
  // still worth shipping to a user in India.
  const local = rec({ sourceId: 'a', countries: ['india'], popularity: 0, highConfidence: false, n: { kcal: 100, proteinG: 0, carbG: 0, fatG: 0, fibreG: 0, sugarG: 0, sodiumMg: 0, satFatG: 0 } });
  const foreign = rec({ sourceId: 'b', countries: ['united-states'], popularity: 100_000 });
  const ctx = { maxPopularity: 100_000, locale: 'in' };
  assert.ok(
    score(foreign, ctx) > score(local, ctx),
    `foreign ${score(foreign, ctx).toFixed(3)} should outrank a thin local record ${score(local, ctx).toFixed(3)}`,
  );
});

test('the build default and the scorer default are the same locale', () => {
  const r = rec({ countries: ['india'] });
  const withDefault = score(r, { maxPopularity: 10 });
  const explicit = score(r, { maxPopularity: 10, locale: DEFAULT_LOCALE });
  assert.equal(withDefault, explicit);
});

test('GS1 prefixes bucket to the region that issued them', () => {
  assert.equal(gs1Region('8901234567894'), 'in');
  assert.equal(gs1Region('0123456789012'), 'us-ca');
  assert.equal(gs1Region('748927012345'), 'us-ca'); // 12 digits, zero-padded to 013
  assert.equal(gs1Region('5012345678900'), 'uk');
  assert.equal(gs1Region(null), 'none');
  // A GTIN-8 has no member-organisation prefix in that position. Padding it to
  // 13 would read as 00x and inflate the US share, which is exactly the number
  // this module exists to report honestly.
  assert.equal(gs1Region('12345670'), 'short');
});

test('regionMix counts a shard by issuing prefix', () => {
  const mix = regionMix([
    { gtin: 8901234567894, gtinDigits: 13 },
    { gtin: 8909876543210, gtinDigits: 13 },
    { gtin: 123456789012, gtinDigits: 13 },
    { gtin: null },
  ]);
  assert.equal(mix.in, 2);
  assert.equal(mix['us-ca'], 1);
  assert.equal(mix.none, 1);
});
