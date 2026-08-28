import type { LocalDate, SetId, SortKey, WorkoutExerciseId } from '@freeforever/data';
import { describe, expect, it } from 'vitest';

import { STARTER_CATALOGUE } from '../catalogue/starter.js';
import { toExerciseRef } from '../catalogue/types.js';
import {
  cellFor,
  commitValuesFor,
  ghostsForExercise,
  ghostsForWorkout,
  isLoggableInOneTap,
} from './ghosts.js';
import type { CompletedSession } from './history.js';
import { orderedSets, startWorkout, workoutReducer } from './session.js';
import type { DraftExercise, DraftSet } from './types.js';

const bench = toExerciseRef(STARTER_CATALOGUE.find((e) => e.id === 'bench-press')!);
const squat = toExerciseRef(STARTER_CATALOGUE.find((e) => e.id === 'back-squat')!);
const plank = toExerciseRef(STARTER_CATALOGUE.find((e) => e.id === 'plank')!);

const NOW = 1_760_000_000_000;

function pastSet(
  index: number,
  weightKg: number | null,
  reps: number | null,
  type: DraftSet['type'] = 'working',
): DraftSet {
  return {
    id: `p${index}` as SetId,
    sortKey: String.fromCharCode(97 + index) as SortKey,
    type,
    state: 'completed',
    loadKind: 'external',
    effortKind: 'reps',
    weightKg,
    reps,
    durationSec: null,
    distanceM: null,
    performedAt: NOW as never,
  };
}

function pastSession(
  exercise: typeof bench,
  sets: readonly DraftSet[],
  startedAt = NOW - 7 * 86_400_000,
): CompletedSession {
  const past: DraftExercise = {
    id: 'px' as WorkoutExerciseId,
    sortKey: 'a' as SortKey,
    exercise,
    sets,
  };
  return {
    id: `w${startedAt}`,
    localDate: '2026-08-21' as LocalDate,
    startedAt,
    exercises: [past],
  };
}

function draftBench(sets = 3, exercise = bench) {
  const state = workoutReducer(startWorkout({ now: NOW }), {
    type: 'add_exercise',
    exercise,
    sets,
    now: NOW,
  });
  const draft = state.workout.exercises[0];
  if (draft === undefined) throw new Error('expected an exercise');
  return { state, draft };
}

describe('carrying last session over', () => {
  it('matches set for set, by position', () => {
    // Top set and backoffs: the third row must carry the third set, not the top set.
    const history = [
      pastSession(bench, [pastSet(0, 100, 5), pastSet(1, 90, 8), pastSet(2, 80, 10)]),
    ];
    const { draft } = draftBench(3);
    const ghosts = ghostsForExercise(draft, history);
    const rows = orderedSets(draft).map((set) => ghosts.get(set.id));

    expect(rows.map((g) => g?.weightKg)).toEqual([100, 90, 80]);
    expect(rows.map((g) => g?.reps)).toEqual([5, 8, 10]);
  });

  it('gives extra rows the last set of last session', () => {
    const history = [pastSession(bench, [pastSet(0, 100, 5), pastSet(1, 100, 5)])];
    const { draft } = draftBench(4);
    const ghosts = ghostsForExercise(draft, history);
    expect(orderedSets(draft).map((set) => ghosts.get(set.id)?.weightKg)).toEqual([
      100, 100, 100, 100,
    ]);
  });

  it('ghosts a warmup off a warmup, not off the first working set', () => {
    // A 20kg bar warmup must never prefill the first working row.
    const history = [
      pastSession(bench, [pastSet(0, 20, 10, 'warmup'), pastSet(1, 100, 5), pastSet(2, 100, 5)]),
    ];
    const { state, draft } = draftBench(0);
    const withWarmup = workoutReducer(state, {
      type: 'add_set',
      exerciseId: draft.id,
      setType: 'warmup',
      now: NOW,
    });
    const withWorking = workoutReducer(withWarmup, {
      type: 'add_set',
      exerciseId: draft.id,
      setType: 'working',
      now: NOW,
    });
    const exercise = withWorking.workout.exercises[0]!;
    const ghosts = ghostsForExercise(exercise, history);
    expect(orderedSets(exercise).map((set) => ghosts.get(set.id)?.weightKg)).toEqual([20, 100]);
  });

  it('reads the most recent session, not the first', () => {
    const history = [
      pastSession(bench, [pastSet(0, 80, 5)], NOW - 14 * 86_400_000),
      pastSession(bench, [pastSet(0, 100, 5)], NOW - 7 * 86_400_000),
    ];
    const { draft } = draftBench(1);
    expect([...ghostsForExercise(draft, history).values()][0]?.weightKg).toBe(100);
  });

  it('has nothing to say about an exercise never done before', () => {
    const history = [pastSession(squat, [pastSet(0, 140, 5)])];
    const { draft } = draftBench(3);
    expect(ghostsForExercise(draft, history).size).toBe(0);
  });

  it('ignores a past session where nothing was attempted', () => {
    const untouched = pastSet(0, 100, 5);
    const history = [pastSession(bench, [{ ...untouched, state: 'pending' }])];
    const { draft } = draftBench(1);
    expect(ghostsForExercise(draft, history).size).toBe(0);
  });

  it('carries a failed set over — it is still what happened', () => {
    const history = [pastSession(bench, [{ ...pastSet(0, 110, 3), state: 'failed' }])];
    const { draft } = draftBench(1);
    expect([...ghostsForExercise(draft, history).values()][0]).toEqual({
      weightKg: 110,
      reps: 3,
      durationSec: null,
      distanceM: null,
    });
  });

  it('covers every exercise in the session at once', () => {
    const history = [
      pastSession(bench, [pastSet(0, 100, 5)]),
      pastSession(squat, [pastSet(0, 140, 5)], NOW - 6 * 86_400_000),
    ];
    const withBoth = workoutReducer(draftBench(1).state, {
      type: 'add_exercise',
      exercise: squat,
      sets: 1,
      now: NOW,
    });
    expect(ghostsForWorkout(withBoth.workout, history).size).toBe(2);
  });
});

describe('a ghost is not data', () => {
  it('lives nowhere on the draft', () => {
    const history = [pastSession(bench, [pastSet(0, 100, 5)])];
    const { draft } = draftBench(1);
    ghostsForExercise(draft, history);
    const set = orderedSets(draft)[0]!;
    // The whole safety property: there is no field for it, so it cannot be written to
    // a document, counted in a total, or survive a reload as though it were logged.
    expect(set.weightKg).toBeNull();
    expect(set.reps).toBeNull();
    expect(Object.keys(set)).not.toContain('ghost');
  });

  it('is reported as a ghost, not as a value', () => {
    expect(cellFor(null, 100)).toEqual({ value: 100, source: 'ghost' });
    expect(cellFor(102.5, 100)).toEqual({ value: 102.5, source: 'entered' });
    expect(cellFor(null, null)).toEqual({ value: null, source: 'empty' });
    expect(cellFor(null, undefined)).toEqual({ value: null, source: 'empty' });
  });

  it('reports an entered zero as entered, not as empty', () => {
    // Zero reps is a fact a lifter can log. `null` is the absence of one.
    expect(cellFor(0, 100)).toEqual({ value: 0, source: 'entered' });
  });
});

describe('what the log button commits', () => {
  it('fills only the empty fields', () => {
    const { draft } = draftBench(1);
    const set = orderedSets(draft)[0]!;
    expect(
      commitValuesFor(set, { weightKg: 100, reps: 5, durationSec: null, distanceM: null }),
    ).toEqual({ weightKg: 100, reps: 5 });

    expect(
      commitValuesFor(
        { ...set, weightKg: 102.5 },
        { weightKg: 100, reps: 5, durationSec: null, distanceM: null },
      ),
    ).toEqual({ reps: 5 });
  });

  it('does not give a plank a phantom rep count', () => {
    const { draft } = draftBench(1, plank);
    const set = orderedSets(draft)[0]!;
    expect(
      commitValuesFor(set, { weightKg: 60, reps: 10, durationSec: 45, distanceM: null }),
    ).toEqual({ durationSec: 45 });
  });

  it('commits nothing when there is no ghost', () => {
    const { draft } = draftBench(1);
    expect(commitValuesFor(orderedSets(draft)[0]!, undefined)).toEqual({});
  });
});

describe('one-tap eligibility', () => {
  it('is true when the effort field has a value or a ghost', () => {
    const { draft } = draftBench(1);
    const set = orderedSets(draft)[0]!;
    expect(isLoggableInOneTap(set, undefined)).toBe(false);
    expect(
      isLoggableInOneTap(set, { weightKg: 100, reps: null, durationSec: null, distanceM: null }),
    ).toBe(false);
    expect(
      isLoggableInOneTap(set, { weightKg: 100, reps: 5, durationSec: null, distanceM: null }),
    ).toBe(true);
    expect(isLoggableInOneTap({ ...set, reps: 5 }, undefined)).toBe(true);
  });

  it('reads the duration field for a timed hold', () => {
    const { draft } = draftBench(1, plank);
    const set = orderedSets(draft)[0]!;
    expect(
      isLoggableInOneTap(set, { weightKg: null, reps: 10, durationSec: null, distanceM: null }),
    ).toBe(false);
    expect(
      isLoggableInOneTap(set, { weightKg: null, reps: null, durationSec: 60, distanceM: null }),
    ).toBe(true);
  });
});
