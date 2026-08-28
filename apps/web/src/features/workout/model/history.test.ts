import type {
  ExerciseVariantId,
  LocalDate,
  SetId,
  SortKey,
  WorkoutExerciseId,
} from '@freeforever/data';
import { describe, expect, it } from 'vitest';

import { STARTER_CATALOGUE } from '../catalogue/starter.js';
import { toExerciseRef } from '../catalogue/types.js';
import {
  byMostRecent,
  historyFor,
  lastTimeFor,
  recentExerciseIds,
  toCompletedSession,
  toPerformedSet,
  type CompletedSession,
} from './history.js';
import { startWorkout, workoutReducer } from './session.js';
import type { DraftExercise, DraftSet } from './types.js';

const bench = toExerciseRef(STARTER_CATALOGUE.find((e) => e.id === 'bench-press')!);
const squat = toExerciseRef(STARTER_CATALOGUE.find((e) => e.id === 'back-squat')!);
const pullUp = toExerciseRef(STARTER_CATALOGUE.find((e) => e.id === 'pull-up')!);

const DAY = 86_400_000;
const NOW = 1_760_000_000_000;

function set(
  index: number,
  weightKg: number | null,
  reps: number | null,
  overrides: Partial<DraftSet> = {},
): DraftSet {
  const base: DraftSet = {
    id: `s${index}` as SetId,
    sortKey: String.fromCharCode(97 + index) as SortKey,
    type: 'working',
    state: 'completed',
    loadKind: 'external',
    effortKind: 'reps',
    weightKg,
    reps,
    durationSec: null,
    distanceM: null,
    performedAt: NOW as never,
    ...overrides,
  };
  // `performedAt` is present if and only if the set was attempted, so a pending set
  // has to drop the key rather than carry an undefined one.
  if (base.state !== 'pending') return base;
  const { performedAt: _unattempted, ...pending } = base;
  return pending;
}

function session(
  startedAt: number,
  exercises: readonly { ref: typeof bench; sets: readonly DraftSet[] }[],
  bodyweightKg?: number,
): CompletedSession {
  const drafts: DraftExercise[] = exercises.map((entry, index) => ({
    id: `x${index}` as WorkoutExerciseId,
    sortKey: String.fromCharCode(97 + index) as SortKey,
    exercise: entry.ref,
    sets: entry.sets,
  }));
  return {
    id: `w${startedAt}`,
    localDate: '2026-08-21' as LocalDate,
    startedAt,
    exercises: drafts,
    ...(bodyweightKg === undefined ? {} : { bodyweightKg }),
  };
}

describe('finding past outings of one lift', () => {
  const sessions = [
    session(NOW - 21 * DAY, [{ ref: bench, sets: [set(0, 90, 5)] }]),
    session(NOW - 14 * DAY, [{ ref: bench, sets: [set(0, 95, 5)] }]),
    session(NOW - 7 * DAY, [{ ref: squat, sets: [set(0, 140, 5)] }]),
    session(NOW - 3 * DAY, [{ ref: bench, sets: [set(0, 100, 5)] }]),
  ];

  it('returns the last three, most recent first', () => {
    const entries = historyFor(bench, sessions);
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.topLoadKg)).toEqual([100, 95, 90]);
  });

  it('skips sessions that did not contain the lift', () => {
    expect(historyFor(bench, sessions).every((entry) => entry.sets.length > 0)).toBe(true);
  });

  it('honours the limit', () => {
    expect(historyFor(bench, sessions, 1)).toHaveLength(1);
    expect(historyFor(bench, sessions, 10)).toHaveLength(3);
  });

  it('is empty for a lift never done', () => {
    expect(historyFor(pullUp, sessions)).toEqual([]);
    expect(lastTimeFor(pullUp, sessions)).toBeNull();
  });

  it('keeps a variant separate from its parent lift', () => {
    // A paused bench PR is not a bench PR, and a paused bench history is not a bench
    // history — variants split for the same reason (SCHEMA.md).
    const paused = { ...bench, variantId: 'paused' as ExerciseVariantId };
    const withPaused = [...sessions, session(NOW - DAY, [{ ref: paused, sets: [set(0, 80, 5)] }])];
    expect(lastTimeFor(bench, withPaused)?.topLoadKg).toBe(100);
    expect(lastTimeFor(paused, withPaused)?.topLoadKg).toBe(80);
  });

  it('sorts by when it happened, not by array order', () => {
    const jumbled = [...sessions].reverse();
    expect(byMostRecent(jumbled)[0]?.startedAt).toBe(NOW - 3 * DAY);
    expect(lastTimeFor(bench, jumbled)?.topLoadKg).toBe(100);
  });
});

describe('what one past outing says', () => {
  it('drops warmups and untouched sets from the working list', () => {
    const entry = lastTimeFor(bench, [
      session(NOW - DAY, [
        {
          ref: bench,
          sets: [
            set(0, 40, 10, { type: 'warmup' }),
            set(1, 100, 5),
            set(2, 100, 5),
            set(3, 100, null, { state: 'pending' }),
          ],
        },
      ]),
    ]);
    expect(entry?.sets).toHaveLength(2);
    expect(entry?.warmupSets).toHaveLength(1);
  });

  it('keeps failed sets — they are what happened', () => {
    const entry = lastTimeFor(bench, [
      session(NOW - DAY, [{ ref: bench, sets: [set(0, 100, 5), set(1, 100, 3, { state: 'failed' })] }]),
    ]);
    expect(entry?.sets).toHaveLength(2);
  });

  it('computes the top set, the volume and the best estimated max', () => {
    const entry = lastTimeFor(bench, [
      session(NOW - DAY, [{ ref: bench, sets: [set(0, 100, 5), set(1, 90, 8)] }]),
    ]);
    expect(entry?.topLoadKg).toBe(100);
    expect(entry?.topSet?.reps).toBe(5);
    expect(entry?.volumeKg).toBe(100 * 5 + 90 * 8);
    // Epley: 90x8 is 114, 100x5 is 116.67. The heavier set is also the better max here.
    expect(entry?.bestE1rmKg).toBeCloseTo(116.67, 1);
  });

  it('never builds an estimated max out of a failed set', () => {
    const entry = lastTimeFor(bench, [
      session(NOW - DAY, [{ ref: bench, sets: [set(0, 140, 1, { state: 'failed' })] }]),
    ]);
    expect(entry?.bestE1rmKg).toBeNull();
    // ...but it is still the heaviest thing that touched the bar that day.
    expect(entry?.topLoadKg).toBe(140);
  });

  it('resolves a bodyweight lift against the session bodyweight', () => {
    const entry = lastTimeFor(pullUp, [
      session(NOW - DAY, [{ ref: pullUp, sets: [set(0, 10, 8, { loadKind: 'bodyweight' })] }], 80),
    ]);
    expect(entry?.topLoadKg).toBe(90);
    expect(entry?.volumeKg).toBe(720);
  });

  it('has no load for a bodyweight lift with no bodyweight recorded', () => {
    const entry = lastTimeFor(pullUp, [
      session(NOW - DAY, [{ ref: pullUp, sets: [set(0, 0, 8, { loadKind: 'bodyweight' })] }]),
    ]);
    expect(entry?.topLoadKg).toBeNull();
    expect(entry?.volumeKg).toBe(0);
  });
});

describe('recents', () => {
  it('lists exercise ids most recently used first, without repeats', () => {
    const sessions = [
      session(NOW - 14 * DAY, [{ ref: squat, sets: [set(0, 140, 5)] }]),
      session(NOW - 7 * DAY, [{ ref: bench, sets: [set(0, 100, 5)] }]),
      session(NOW - 3 * DAY, [
        { ref: squat, sets: [set(0, 145, 5)] },
        { ref: pullUp, sets: [set(0, 0, 8, { loadKind: 'bodyweight' })] },
      ]),
    ];
    expect(recentExerciseIds(sessions)).toEqual(['back-squat', 'pull-up', 'bench-press']);
  });

  it('honours the limit', () => {
    const sessions = [
      session(NOW, [
        { ref: squat, sets: [set(0, 1, 1)] },
        { ref: bench, sets: [set(0, 1, 1)] },
        { ref: pullUp, sets: [set(0, 1, 1)] },
      ]),
    ];
    expect(recentExerciseIds(sessions, 2)).toHaveLength(2);
  });

  it('is empty with no history', () => {
    expect(recentExerciseIds([])).toEqual([]);
  });
});

describe('converting a draft set for the maths', () => {
  it('maps each load kind onto the right union member', () => {
    expect(toPerformedSet(set(0, 100, 5)).load).toEqual({ kind: 'external', weightKg: 100 });
    expect(toPerformedSet(set(0, 10, 5, { loadKind: 'bodyweight' })).load).toEqual({
      kind: 'bodyweight',
      addedWeightKg: 10,
    });
    expect(toPerformedSet(set(0, 30, 5, { loadKind: 'assisted' })).load).toEqual({
      kind: 'assisted',
      assistanceKg: 30,
    });
    expect(toPerformedSet(set(0, null, 5, { loadKind: 'none' })).load).toEqual({ kind: 'none' });
  });

  it('maps each effort kind', () => {
    expect(
      toPerformedSet(set(0, null, null, { effortKind: 'duration', durationSec: 60 })).effort,
    ).toEqual({ kind: 'duration', durationSec: 60 });
    expect(
      toPerformedSet(set(0, null, null, { effortKind: 'distance', distanceM: 2000, durationSec: 420 }))
        .effort,
    ).toEqual({ kind: 'distance', distanceM: 2000, durationSec: 420 });
  });

  it('turns an unfilled number into zero only on the way into a calculation', () => {
    // The draft keeps `null` because a half-filled row is a real state. The core does
    // not, because a fold over half-filled rows is a fold over nothing.
    expect(toPerformedSet(set(0, null, null)).effort).toEqual({ kind: 'reps', reps: 0 });
    expect(toPerformedSet(set(0, null, null)).load).toEqual({ kind: 'external', weightKg: 0 });
  });
});

describe('a finished draft becomes next session’s history', () => {
  it('round-trips through the conversion', () => {
    const state = workoutReducer(startWorkout({ now: NOW, bodyweightKg: 82 }), {
      type: 'add_exercise',
      exercise: bench,
      sets: 1,
      now: NOW,
    });
    const exercise = state.workout.exercises[0]!;
    const logged = workoutReducer(state, {
      type: 'set_set_state',
      exerciseId: exercise.id,
      setId: exercise.sets[0]!.id,
      state: 'completed',
      commit: { weightKg: 100, reps: 5 },
      now: NOW,
    });
    const finished = workoutReducer(logged, { type: 'finish', now: NOW + 3600_000 });

    const completed = toCompletedSession(finished.workout);
    expect(completed.bodyweightKg).toBe(82);
    expect(lastTimeFor(bench, [completed])?.topLoadKg).toBe(100);
  });

  it('omits a bodyweight that was never recorded rather than storing undefined', () => {
    const completed = toCompletedSession(startWorkout({ now: NOW }).workout);
    expect('bodyweightKg' in completed).toBe(false);
  });
});
