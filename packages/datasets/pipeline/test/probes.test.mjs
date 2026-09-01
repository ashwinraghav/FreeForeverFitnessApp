/**
 * Does the probe harness actually fail when it should?
 *
 * The probes themselves run against a full build, which CI does not have. That
 * makes them exactly the shape CLAUDE.md warns about: a check whose green state
 * proves nothing, because nobody has seen it go red. So these tests drive
 * `runProbes` against stub readers and assert both directions — a probe that
 * finds its food passes, and a probe whose food is missing, mis-ranked,
 * duplicated, or wrongly-served fails with a message that names the reason.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PROBES, runProbes } from '../lib/probes.mjs';

/** The real acceptance case, as the reader would hand it back. */
const GOLD_STANDARD = {
  id: 'off:0748927065794',
  sourceId: '0748927065794',
  source: 'off',
  brand: 'Optimum Nutrition',
  name: 'Gold Standard Whey (Vanilla Ice Cream Flavour)',
  servingGrams: 31,
  servingLabel: '1 scoop',
  per100: { kcal: 387, proteinG: 77, carbG: 13, fatG: 3 },
};

/** @param {any[]} foods */
const readerOf = (foods) => ({
  length: foods.length,
  get: (/** @type {number} */ i) => foods[i] ?? null,
  search: () => foods.map((food) => ({ food })),
});

/** Run only the named probe, by pointing every other shard at an empty reader. */
function runOne(id, foods) {
  const probe = PROBES.find((p) => p.id === id);
  assert.ok(probe, `no probe named ${id}`);
  const results = runProbes({ [probe.shard]: readerOf(foods) });
  const r = results.find((x) => x.id === id);
  assert.ok(r);
  return r;
}

test('the acceptance probe passes against the record it was written for', () => {
  const r = runOne('gold-standard-whey-vanilla', [GOLD_STANDARD]);
  assert.equal(r.ok, true, r.detail);
  // The detail line is the subtitle the user asked to see, so pin its shape.
  assert.match(r.detail, /Optimum Nutrition/);
  assert.match(r.detail, /1 scoop \(31 g\)/);
  assert.match(r.detail, /~120 kcal/);
  assert.match(r.detail, /~23\.9 g protein/);
});

test('a probe fails when its food is gone from the index', () => {
  const r = runOne('gold-standard-whey-vanilla', [
    { ...GOLD_STANDARD, name: 'Something Else Entirely', brand: 'Another Brand' },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.detail, /none matching/);
});

test('a probe fails when duplicates of one product both survive', () => {
  // The regression the cluster dedupe exists to prevent. Two rows, both
  // matching, is the state the user complained about.
  const r = runOne('gold-standard-whey-vanilla', [
    GOLD_STANDARD,
    { ...GOLD_STANDARD, id: 'off:0748927065954', name: 'Gold Standard 100% Whey Vanilla Flavour' },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.detail, /2 rows match where 1 should/);
});

test('a probe fails when its food is buried below the rank it must reach', () => {
  const filler = Array.from({ length: 5 }, (_, i) => ({
    ...GOLD_STANDARD,
    id: `off:filler${i}`,
    name: 'Gold Standard Pre Workout',
    brand: 'Optimum Nutrition',
  }));
  // Filler ranks above, and does not match `name`, so the real record is #6
  // against a withinTop of 3.
  const r = runOne('gold-standard-whey-vanilla', [
    ...filler.map((f) => ({ ...f, name: 'Whey Something', brand: 'Other' })),
    GOLD_STANDARD,
  ]);
  assert.equal(r.ok, false);
  assert.match(r.detail, /ranked 6, must be within the top 3/);
});

test('a probe fails when the serving label stops answering "one serving = what?"', () => {
  const r = runOne('gold-standard-whey-vanilla', [{ ...GOLD_STANDARD, servingLabel: '31 g' }]);
  assert.equal(r.ok, false);
  assert.match(r.detail, /serving label/);
});

test('a probe fails when the nutrition drifts out of range', () => {
  // The 3x basis error: per-serving figures typed into the per-100 g field.
  const r = runOne('gold-standard-whey-vanilla', [
    { ...GOLD_STANDARD, per100: { ...GOLD_STANDARD.per100, kcal: 120, proteinG: 24 } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.detail, /kcal\/serving is 37\.2, expected 110–130/);
});

test('a probe fails loudly when its shard is absent rather than passing vacuously', () => {
  const results = runProbes({});
  assert.ok(results.length > 0);
  assert.ok(
    results.every((r) => !r.ok && /no (core|off) shard/.test(r.detail)),
    'an empty build must fail every probe, not skip them',
  );
});

test('every probe declares why it exists and which shard it reads', () => {
  for (const p of PROBES) {
    assert.match(p.id, /^[a-z0-9-]+$/, `probe id ${p.id} should be a slug`);
    assert.ok(p.why.length > 20, `probe ${p.id} needs a real reason, not a label`);
    assert.ok(p.shard === 'core' || p.shard === 'off', `probe ${p.id} has no shard`);
    assert.ok(p.query.trim().length > 0, `probe ${p.id} has no query`);
    assert.ok(p.name instanceof RegExp, `probe ${p.id} has no name matcher`);
  }
  assert.equal(new Set(PROBES.map((p) => p.id)).size, PROBES.length, 'probe ids must be unique');
});
