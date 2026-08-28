/**
 * Exercise catalogue: the reader, and the guarantees consumers depend on.
 *
 * The two `unmapped*Names` tests are adopted from the workout team's adapter.
 * They assert against the live artefact, so the day free-exercise-db is rebuilt
 * with a new muscle or equipment name, CI fails here instead of the app
 * silently shipping an exercise with an empty muscle split. Same philosophy as
 * the ODbL checks in verify-index.mjs: an invariant is only real if something
 * breaks when it does.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CATALOGUE_SIZE, openExerciseCatalogue } from '../../src/exercises.mjs';
import { ALL_MUSCLES, MUSCLE_GROUP, splitShoulders } from '../lib/muscles.mjs';

const catalogue = await openExerciseCatalogue();

test('the catalogue loads from the packaged artefact', async () => {
  assert.equal(catalogue.length, 873);
  assert.equal(catalogue.length, CATALOGUE_SIZE.exercises, 'declared size is stale');
  assert.ok(catalogue.schemaVersion > 0);
});

test('it can be loaded from bytes and from a url without touching the filesystem', async () => {
  const { readFile } = await import('node:fs/promises');
  const bytes = new Uint8Array(await readFile(new URL('../../build/exercises.json.gz', import.meta.url)));

  const fromBytes = await openExerciseCatalogue({ bytes });
  assert.equal(fromBytes.length, 873);

  const fromUrl = await openExerciseCatalogue({
    url: 'https://example.invalid/exercises.json.gz',
    fetchImpl: async () => new Response(bytes, { status: 200 }),
  });
  assert.equal(fromUrl.length, 873);
});

test('a failed fetch throws with the url rather than a decode error', async () => {
  await assert.rejects(
    () =>
      openExerciseCatalogue({
        url: 'https://example.invalid/missing.gz',
        fetchImpl: async () => new Response('', { status: 404 }),
      }),
    /404.*missing\.gz/,
  );
});

test('unmappedMuscleNames is empty against a complete map', () => {
  // This is the assertion a consumer runs against its own enum. Ours is
  // complete by construction; the test exists to prove the mechanism works and
  // to fail loudly if the published vocabulary and the artefact diverge.
  assert.deepEqual(catalogue.unmappedMuscleNames(ALL_MUSCLES), []);

  const used = new Set(
    catalogue.all().flatMap((e) => [...e.primaryMuscles, ...e.secondaryMuscles]),
  );
  const undeclared = [...used].filter((m) => !catalogue.muscles.includes(m));
  assert.deepEqual(undeclared, [], 'every muscle in use must be in the published vocabulary');
});

test('unmappedMuscleNames reports a name a consumer has not covered', () => {
  const partial = ALL_MUSCLES.filter((m) => m !== 'rear-delts');
  assert.deepEqual(catalogue.unmappedMuscleNames(partial), ['rear-delts']);
});

test('unmappedEquipmentNames is empty against the published vocabulary', () => {
  assert.deepEqual(catalogue.unmappedEquipmentNames(catalogue.equipment), []);

  const used = new Set(catalogue.all().map((e) => e.equipment));
  const undeclared = [...used].filter((e) => !catalogue.equipment.includes(e));
  assert.deepEqual(undeclared, [], 'every equipment value in use must be published');
});

test('the deltoid split beats the force heuristic on the cases where they disagree', () => {
  // Every one of these is marked force=push upstream, and every one is lateral
  // or posterior work. push -> front-delts would get all of them wrong.
  for (const name of [
    'Side Lateral Raise',
    'Seated Side Lateral Raise',
    'One-Arm Side Laterals',
    'Alternating Deltoid Raise',
    'Lateral Raise - With Bands',
  ]) {
    const e = catalogue.all().find((x) => x.name === name);
    assert.ok(e, `${name} missing from the catalogue`);
    assert.deepEqual(e.primaryMuscles, ['side-delts'], name);
  }

  // Marked pull, and lateral rather than posterior.
  assert.deepEqual(
    catalogue.all().find((x) => x.name === 'Upright Barbell Row')?.primaryMuscles,
    ['side-delts'],
  );
});

test('presses, rows and raises land on the right head', () => {
  const head = (/** @type {string} */ n) =>
    catalogue.all().find((x) => x.name === n)?.primaryMuscles;
  assert.deepEqual(head('Barbell Shoulder Press'), ['front-delts']);
  assert.deepEqual(head('Face Pull'), ['rear-delts']);
  assert.deepEqual(head('Reverse Flyes'), ['rear-delts']);
  assert.deepEqual(head('Side Laterals to Front Raise'), ['front-delts', 'side-delts']);
});

test('deltoid involvement in a compound falls back to the movement class', () => {
  const bench = catalogue.all().find((x) => x.name === 'Barbell Bench Press - Medium Grip');
  assert.ok(bench?.secondaryMuscles.includes('front-delts'));
  const row = catalogue.all().find((x) => x.name === 'Bent Over Barbell Row');
  assert.ok(row?.secondaryMuscles.includes('rear-delts'));
});

test('an inconclusive movement keeps the generic muscle and says so', () => {
  // Honesty over coverage: a Turkish get-up works all three heads and a
  // confident single answer would be fabricated.
  assert.equal(
    splitShoulders('Kettlebell Turkish Get-Up (Squat style)', true).basis,
    'name',
    'a get-up is an overhead-support pattern, so the front head is conclusive',
  );
  assert.deepEqual(splitShoulders('Battling Ropes', true), {
    heads: ['shoulders'],
    basis: 'unspecified',
  });

  const stretch = catalogue.all().find((x) => x.name === 'Shoulder Stretch');
  assert.deepEqual(stretch?.primaryMuscles, ['shoulders']);
  assert.equal(stretch?.deltoidBasis, 'unspecified');
});

test('every specific head rolls up to a group', () => {
  for (const head of ['front-delts', 'side-delts', 'rear-delts']) {
    assert.equal(MUSCLE_GROUP[head], 'shoulders');
    assert.equal(catalogue.muscleGroups[head], 'shoulders');
  }
  // Filtering by the group finds the heads.
  const byGroup = catalogue.filter({ muscle: 'shoulders' });
  const bySpecific = catalogue.filter({ muscle: 'side-delts' });
  assert.ok(bySpecific.length > 0);
  assert.ok(byGroup.length > bySpecific.length, 'the group is a superset of any one head');
  assert.ok(byGroup.some((e) => e.primaryMuscles.includes('front-delts')));
});

test('a muscle is never both primary and secondary on the same exercise', () => {
  for (const e of catalogue.all()) {
    const overlap = e.primaryMuscles.filter((m) => e.secondaryMuscles.includes(m));
    assert.deepEqual(overlap, [], `${e.name} lists ${overlap.join(',')} twice`);
  }
});

test('every exercise has an effort unit, and holds are not counted in reps', () => {
  const units = new Set(catalogue.all().map((e) => e.effortUnit));
  assert.deepEqual([...units].sort(), ['distance', 'reps', 'time']);

  const unit = (/** @type {string} */ n) =>
    catalogue.all().find((x) => x.name === n)?.effortUnit;
  assert.equal(unit('Plank'), 'time');
  assert.equal(unit('Side Bridge'), 'time');
  assert.equal(unit("Farmer's Walk"), 'distance');
  assert.equal(unit('Barbell Squat'), 'reps');
  // Regressions from tightening the patterns: these read as holds or carries
  // but are counted in reps.
  assert.equal(unit('Barbell Glute Bridge'), 'reps');
  assert.equal(unit('Rickshaw Deadlift'), 'reps');
  assert.equal(unit('Drag Curl'), 'reps');

  // Every stretch is held.
  for (const e of catalogue.all()) {
    if (e.category === 'stretching') assert.equal(e.effortUnit, 'time', e.name);
  }
});

test('search matches names and gym shorthand', () => {
  assert.ok(catalogue.search('ohp').length > 0);
  assert.equal(catalogue.search('barbell squat')[0]?.exercise.name, 'Barbell Squat');
  assert.ok(catalogue.search('bb squ').length > 0, 'prefix on the last token');
  assert.deepEqual(catalogue.search(''), []);
  assert.deepEqual(catalogue.search('zzzzzz'), []);
});

test('get and filter behave', () => {
  assert.equal(catalogue.get('Barbell_Squat')?.name, 'Barbell Squat');
  assert.equal(catalogue.get('nope'), null);
  const barbellQuads = catalogue.filter({ muscle: 'quads', equipment: 'barbell' });
  assert.ok(barbellQuads.length > 0);
  assert.ok(barbellQuads.every((e) => e.equipment === 'barbell'));
});

test('coaching is marked as generated, not authored', () => {
  // The app renders generated coaching with less authority than written
  // coaching, so this flag must survive any rebuild.
  assert.equal(catalogue.coaching.authored, false);
  assert.ok(catalogue.all().every((e) => e.coachingAuthored === false));
});

test('a malformed document is rejected rather than half-loaded', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ nope: true }));
  await assert.rejects(() => openExerciseCatalogue({ bytes }), /not an exercise catalogue/);
});

test('CATALOGUE_SIZE tracks the real artefact', async () => {
  // The declared size is what consumers use to decide whether to lazy-load, so
  // it must not drift into fiction. 5% tolerance: a rebuild moves it slightly,
  // a schema change moves it a lot, and only the second should demand attention.
  const { stat } = await import('node:fs/promises');
  const { size } = await stat(new URL('../../build/exercises.json.gz', import.meta.url));
  const drift = Math.abs(size - CATALOGUE_SIZE.gzipBytes) / size;
  assert.ok(
    drift < 0.05,
    `CATALOGUE_SIZE.gzipBytes is ${CATALOGUE_SIZE.gzipBytes}, artefact is ${size} ` +
      `(${(drift * 100).toFixed(1)}% off) — update src/exercises.mjs and re-check the ` +
      'lazy-load guidance in docs/exercise-catalogue.md',
  );
});
