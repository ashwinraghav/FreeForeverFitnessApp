import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { adaptCatalogue, type DatasetExercise } from '../catalogue/fromDatasets.js';
import { mergeCatalogues } from '../catalogue/merge.js';
import { STARTER_CATALOGUE } from '../catalogue/starter.js';
import { toExerciseRef } from '../catalogue/types.js';
import { toCompletedSession, type CompletedSession } from './history.js';
import { recommendedExerciseIds, RECOMMEND_LIMIT } from './recommend.js';
import { orderedSets, startWorkout, workoutReducer } from './session.js';

const NOW = 1_760_000_000_000;
const DAY = 86_400_000;

const entry = (id: string) => STARTER_CATALOGUE.find((candidate) => candidate.id === id)!;

/** A finished session of the given lifts, every set completed. */
function sessionOf(daysAgo: number, ...ids: readonly string[]): CompletedSession {
  const at = NOW - daysAgo * DAY;
  let state = startWorkout({ now: at });
  for (const id of ids) {
    state = workoutReducer(state, {
      type: 'add_exercise',
      exercise: toExerciseRef(entry(id)),
      sets: 3,
      now: at,
    });
  }
  for (const exercise of state.workout.exercises) {
    for (const set of orderedSets(exercise)) {
      state = workoutReducer(state, {
        type: 'set_set_state',
        exerciseId: exercise.id,
        setId: set.id,
        state: 'completed',
        commit: { weightKg: 60, reps: 8 },
        now: at,
      });
    }
  }
  return toCompletedSession(workoutReducer(state, { type: 'finish', now: at + 3600_000 }).workout);
}

/** Same as `sessionOf`, but able to reach the dataset rows too. */
function sessionOfFull(daysAgo: number, ...ids: readonly string[]): CompletedSession {
  const at = NOW - daysAgo * DAY;
  let state = startWorkout({ now: at });
  for (const id of ids) {
    state = workoutReducer(state, {
      type: 'add_exercise',
      exercise: toExerciseRef(FULL.find((candidate) => candidate.id === id)!),
      sets: 3,
      now: at,
    });
  }
  for (const exercise of state.workout.exercises) {
    for (const set of orderedSets(exercise)) {
      state = workoutReducer(state, {
        type: 'set_set_state',
        exerciseId: exercise.id,
        setId: set.id,
        state: 'completed',
        commit: { weightKg: 60, reps: 8 },
        now: at,
      });
    }
  }
  return toCompletedSession(workoutReducer(state, { type: 'finish', now: at + 3600_000 }).workout);
}

const musclesOf = (id: string): readonly string[] =>
  entry(id).muscles.filter((share) => share.fraction >= 0.5).map((share) => share.muscle);

describe('what to train next, from the last three sessions', () => {
  it('says nothing at all when there is no history', () => {
    // No opinion is the honest answer. Ranking the catalogue by an arbitrary tiebreak
    // and calling it advice would be worse than an unchanged picker.
    expect(recommendedExerciseIds([], STARTER_CATALOGUE)).toEqual([]);
  });

  it('recommends pulling after three sessions of pushing', () => {
    const history = [
      sessionOf(1, 'bench-press', 'overhead-press'),
      sessionOf(3, 'incline-bench-press', 'dumbbell-shoulder-press'),
      sessionOf(5, 'close-grip-bench', 'dumbbell-fly'),
    ];
    const ids = recommendedExerciseIds(history, STARTER_CATALOGUE);

    expect(ids.length).toBeGreaterThan(0);
    const trained = new Set(ids.flatMap(musclesOf));
    // Something for the back, which three push days did nothing for.
    expect([...trained].some((muscle) => ['lats', 'upper_back'].includes(muscle))).toBe(true);
    // And nothing whose whole job is the chest they have hammered.
    expect(trained.has('chest')).toBe(false);
  });

  it('recommends upper body after three leg days', () => {
    const history = [
      sessionOf(1, 'back-squat', 'leg-press'),
      sessionOf(3, 'front-squat', 'lying-leg-curl'),
      sessionOf(5, 'hack-squat', 'leg-extension'),
    ];
    const trained = new Set(recommendedExerciseIds(history, STARTER_CATALOGUE).flatMap(musclesOf));

    expect(trained.has('quads')).toBe(false);
    expect([...trained].some((muscle) => ['chest', 'lats', 'upper_back'].includes(muscle))).toBe(
      true,
    );
  });

  it('never recommends something already done in the window', () => {
    const history = [sessionOf(1, 'bench-press'), sessionOf(2, 'barbell-row')];
    const ids = recommendedExerciseIds(history, STARTER_CATALOGUE);

    expect(ids).not.toContain('bench-press');
    expect(ids).not.toContain('barbell-row');
  });

  it('reads only the last three sessions, so old training stops counting', () => {
    // Legs four sessions ago, push since. Legs are due again despite having been done.
    const history = [
      sessionOf(1, 'bench-press'),
      sessionOf(2, 'overhead-press'),
      sessionOf(3, 'incline-bench-press'),
      sessionOf(20, 'back-squat', 'leg-press', 'lying-leg-curl'),
    ];
    const trained = new Set(recommendedExerciseIds(history, STARTER_CATALOGUE).flatMap(musclesOf));
    expect([...trained].some((muscle) => ['quads', 'hamstrings', 'glutes'].includes(muscle))).toBe(
      true,
    );
  });

  it('picks the familiar lift for a muscle over one never done', () => {
    /*
     * Familiarity decides *which* exercise represents a neglected muscle, not the order
     * of the muscles themselves. It used to outrank everything, which meant one known
     * lift took the top slot and the breadth below it was whatever fell out; breadth is
     * the more useful property, so it now comes first and familiarity breaks ties inside
     * each muscle.
     */
    const push = [
      sessionOf(1, 'bench-press'),
      sessionOf(2, 'overhead-press'),
      sessionOf(3, 'incline-bench-press'),
    ];
    const lats = (history: readonly CompletedSession[]) =>
      recommendedExerciseIds(history, STARTER_CATALOGUE, { limit: 30 }).find(
        (id) => entry(id).muscles[0]?.muscle === 'lats',
      );

    // `pull-up` is what the curated order offers for lats by default...
    const byDefault = lats(push);
    expect(byDefault).toBeDefined();

    // ...but a lat pulldown the lifter has actually done takes the slot instead.
    const withHistory = lats([...push, sessionOf(30, 'lat-pulldown')]);
    expect(withHistory).toBe('lat-pulldown');
    expect(withHistory).not.toBe(byDefault);
  });

  it('excludes what is already in the session being built', () => {
    const history = [sessionOf(1, 'bench-press'), sessionOf(2, 'overhead-press')];
    const all = recommendedExerciseIds(history, STARTER_CATALOGUE);
    expect(all.length).toBeGreaterThan(0);

    const without = recommendedExerciseIds(history, STARTER_CATALOGUE, {
      excludeIds: [all[0]!],
    });
    expect(without).not.toContain(all[0]);
  });

  it('spreads across muscles rather than listing six squat variants', () => {
    const history = [sessionOf(1, 'bench-press'), sessionOf(2, 'overhead-press')];
    const ids = recommendedExerciseIds(history, STARTER_CATALOGUE);

    const primaries = ids.map((id) => entry(id).muscles[0]?.muscle);
    for (const muscle of new Set(primaries)) {
      expect(primaries.filter((candidate) => candidate === muscle).length).toBeLessThanOrEqual(2);
    }
  });

  it('stays short enough to be a hint rather than a second catalogue', () => {
    const history = [sessionOf(1, 'bench-press')];
    expect(recommendedExerciseIds(history, STARTER_CATALOGUE).length).toBeLessThanOrEqual(
      RECOMMEND_LIMIT,
    );
  });

  it('is deterministic — the same history gives the same answer', () => {
    const history = [sessionOf(1, 'bench-press'), sessionOf(2, 'back-squat')];
    expect(recommendedExerciseIds(history, STARTER_CATALOGUE)).toEqual(
      recommendedExerciseIds(history, STARTER_CATALOGUE),
    );
  });
});

/*
 * Both of these were real, both shipped past the first round of tests above, and both
 * were only visible against the *merged* ~900-entry catalogue — the fixtures used the
 * 70-entry starter set, where neither can occur. That is the lesson worth keeping: a
 * ranking test on a curated fixture proves nothing about ranking over the long tail.
 */
const FULL = mergeCatalogues(
  STARTER_CATALOGUE,
  adaptCatalogue(
    (
      JSON.parse(
        new TextDecoder().decode(
          gunzipSync(
            readFileSync(
              fileURLToPath(
                new URL(
                  '../../../../../../packages/datasets/build/exercises.json.gz',
                  import.meta.url,
                ),
              ),
            ),
          ),
        ),
      ) as { exercises: DatasetExercise[] }
    ).exercises,
  ),
);

describe('recommending against the full ~900-entry catalogue', () => {
  const skippedBackDay = [
    sessionOf(1, 'bench-press', 'overhead-press'),
    sessionOf(3, 'incline-bench-press', 'dumbbell-shoulder-press'),
    sessionOf(5, 'close-grip-bench', 'dumbbell-fly'),
  ];

  it('never suggests the strongman corner of the dataset', () => {
    // Measured before the fix: Tire Flip, Keg Load, Sandbag Load and Log Lift took the
    // top four slots, because summing shortfalls rewards touching many muscles at once.
    const ids = recommendedExerciseIds(skippedBackDay, FULL);
    const names = ids.map((id) => FULL.find((entry) => entry.id === id)?.name ?? id);

    expect(names.join(' | ')).not.toMatch(/tire flip|keg load|sandbag|log lift/i);
  });

  it('only ever suggests a curated lift or one already in the log', () => {
    // `Set<string>` explicitly: both id types are branded, and `has` on a branded set
    // refuses the plain strings the function returns.
    const curated = new Set<string>(STARTER_CATALOGUE.map((entry) => entry.id));
    const logged = new Set<string>(
      skippedBackDay.flatMap((s) => s.exercises.map((e) => e.exercise.exerciseId)),
    );
    for (const id of recommendedExerciseIds(skippedBackDay, FULL)) {
      expect(curated.has(id) || logged.has(id)).toBe(true);
    }
  });

  it('still answers the actual question — this lifter owes their back something', () => {
    // The negative assertions above would all pass on an empty list, so prove the
    // positive in the same file.
    const ids = recommendedExerciseIds(skippedBackDay, FULL);
    expect(ids.length).toBeGreaterThan(0);

    const trained = new Set(
      ids.flatMap((id) =>
        (FULL.find((entry) => entry.id === id)?.muscles ?? [])
          .filter((share) => share.fraction >= 0.5)
          .map((share) => share.muscle),
      ),
    );
    expect([...trained].some((muscle) => ['lats', 'upper_back'].includes(muscle))).toBe(true);
  });

  it('can suggest a long-tail lift once the lifter has actually done it', () => {
    // The 830 are a tail to be found, not a pool to push from — but once it is in your
    // log it is yours, and it competes like anything else. `Straight-Arm_Pulldown` is
    // the litmus-test exercise, and a dataset row rather than a curated one.
    const never = recommendedExerciseIds(skippedBackDay, FULL, { limit: 30 });
    expect(never).not.toContain('Straight-Arm_Pulldown');

    const done = recommendedExerciseIds(
      [...skippedBackDay, sessionOfFull(40, 'Straight-Arm_Pulldown')],
      FULL,
      { limit: 30 },
    );
    expect(done).toContain('Straight-Arm_Pulldown');
  });
});
