import { describe, expect, it } from 'vitest';
import type { ExerciseShape, PerformedSet, SetKind, SetState } from './types.js';
import {
  hardSetCount,
  hardSetsByMuscle,
  sessionTotals,
  setVolumeKg,
  tonnageKg,
  volumeKgByMuscle,
} from './volume.js';

function set(
  weightKg: number,
  reps: number,
  state: SetState = 'completed',
  type: SetKind = 'working',
): PerformedSet {
  return {
    type,
    state,
    load: { kind: 'external', weightKg },
    effort: { kind: 'reps', reps },
  };
}

const bench: ExerciseShape = {
  unilateral: false,
  muscles: [
    { muscle: 'chest', fraction: 1 },
    { muscle: 'triceps', fraction: 0.5 },
    { muscle: 'front_delts', fraction: 0.5 },
  ],
};

const bulgarianSplitSquat: ExerciseShape = {
  unilateral: true,
  muscles: [
    { muscle: 'quads', fraction: 1 },
    { muscle: 'glutes', fraction: 0.7 },
  ],
};

describe('one set', () => {
  it('is load times reps', () => {
    expect(setVolumeKg(set(100, 5))).toBe(500);
  });

  it('has no volume for a timed hold', () => {
    // A plank has no tonnage. `null`, not zero, so a set-level display can say "—".
    const plank: PerformedSet = {
      type: 'working',
      state: 'completed',
      load: { kind: 'none' },
      effort: { kind: 'duration', durationSec: 60 },
    };
    expect(setVolumeKg(plank)).toBeNull();
  });

  it('has no volume when the load cannot be resolved', () => {
    const pullUp: PerformedSet = {
      type: 'working',
      state: 'completed',
      load: { kind: 'bodyweight', addedWeightKg: 0 },
      effort: { kind: 'reps', reps: 10 },
    };
    expect(setVolumeKg(pullUp)).toBeNull();
    expect(setVolumeKg(pullUp, { bodyweightKg: 80 })).toBe(800);
  });

  it('counts the reps of a reps-and-duration set', () => {
    const cluster: PerformedSet = {
      type: 'cluster',
      state: 'completed',
      load: { kind: 'external', weightKg: 60 },
      effort: { kind: 'reps_and_duration', reps: 8, durationSec: 40 },
    };
    expect(setVolumeKg(cluster)).toBe(480);
  });
});

describe('what counts', () => {
  const sets = [
    set(60, 10, 'completed', 'warmup'),
    set(100, 5, 'completed'),
    set(100, 3, 'failed'),
    set(100, 5, 'pending'),
  ];

  it('excludes warmups and untouched sets', () => {
    // 100x5 completed + 100x3 failed = 800. The warmup and the pending set are out.
    expect(tonnageKg(sets)).toBe(800);
  });

  it('can be told to drop failed work', () => {
    expect(tonnageKg(sets, { includeFailed: false })).toBe(500);
  });

  it('can be told to include warmups', () => {
    expect(tonnageKg(sets, { includeWarmups: true })).toBe(1400);
  });

  it('counts hard sets the same way', () => {
    expect(hardSetCount(sets)).toBe(2);
    expect(hardSetCount(sets, { includeFailed: false })).toBe(1);
  });

  it('a pending set is never work, however it is configured', () => {
    const pendingOnly = [set(100, 5, 'pending')];
    expect(tonnageKg(pendingOnly, { includeFailed: true, includeWarmups: true })).toBe(0);
    expect(hardSetCount(pendingOnly, { includeFailed: true, includeWarmups: true })).toBe(0);
  });
});

describe('splitting volume across muscles', () => {
  it('uses the exercise fractions rather than counting every muscle whole', () => {
    // 100x5 = 500kg. Chest takes all of it, triceps and delts half each. A naive
    // implementation gives 500 to all three and every chart double-counts.
    const byMuscle = volumeKgByMuscle([set(100, 5)], bench);
    expect(byMuscle).toEqual({ chest: 500, triceps: 250, front_delts: 250 });
  });

  it('doubles unilateral work', () => {
    // One logged set of ten on a split squat is ten each side.
    const byMuscle = volumeKgByMuscle([set(40, 10)], bulgarianSplitSquat);
    expect(byMuscle['quads']).toBe(800);
    expect(byMuscle['glutes']).toBe(560);
  });

  it('leaves a muscle absent rather than storing a zero', () => {
    // `muscleVolumeMapSchema` is a partial map on purpose: an exhaustive record would
    // make every session carry twenty-one zeroes.
    const byMuscle = volumeKgByMuscle([set(100, 5)], {
      unilateral: false,
      muscles: [
        { muscle: 'lats', fraction: 1 },
        { muscle: 'biceps', fraction: 0 },
      ],
    });
    expect(Object.keys(byMuscle)).toEqual(['lats']);
  });

  it('is empty when nothing counted', () => {
    expect(volumeKgByMuscle([set(100, 5, 'pending')], bench)).toEqual({});
  });
});

describe('hard sets per muscle', () => {
  it('counts whole sets, not fractions', () => {
    // "Twelve sets for chest this week" is a count of sets. A programme that reports
    // 9.5 has quietly changed the unit it is prescribing in.
    const byMuscle = hardSetsByMuscle([set(100, 5), set(100, 5)], bench);
    expect(byMuscle).toEqual({ chest: 2, triceps: 2, front_delts: 2 });
  });

  it('drops muscles below the threshold', () => {
    const byMuscle = hardSetsByMuscle([set(100, 5)], bench, { threshold: 0.75 });
    expect(byMuscle).toEqual({ chest: 1 });
  });

  it('counts a failed set as a hard set', () => {
    expect(hardSetsByMuscle([set(100, 3, 'failed')], bench)['chest']).toBe(1);
  });
});

describe('session totals — the shape written onto the document', () => {
  it('counts every set, and splits them by state', () => {
    const totals = sessionTotals([
      {
        exercise: bench,
        sets: [
          set(60, 10, 'completed', 'warmup'),
          set(100, 5, 'completed'),
          set(100, 5, 'completed'),
          set(100, 3, 'failed'),
          set(100, 5, 'pending'),
        ],
      },
    ]);

    expect(totals.exerciseCount).toBe(1);
    expect(totals.setCount).toBe(5);
    expect(totals.workingSetCount).toBe(4);
    expect(totals.completedSetCount).toBe(3);
    expect(totals.failedSetCount).toBe(1);
  });

  it('sums volume over completed working sets only', () => {
    // Following `workoutTotalsSchema.volumeKg` to the letter: the warmup is out and so
    // is the failed set. `tonnageKg` is where failed work is counted; the two numbers
    // answer different questions and the discrepancy is flagged in the module docs.
    const totals = sessionTotals([
      {
        exercise: bench,
        sets: [
          set(60, 10, 'completed', 'warmup'),
          set(100, 5, 'completed'),
          set(100, 3, 'failed'),
        ],
      },
    ]);
    expect(totals.volumeKg).toBe(500);
    expect(tonnageKg([set(60, 10, 'completed', 'warmup'), set(100, 5), set(100, 3, 'failed')])).toBe(800);
  });

  it('merges muscle volume across exercises', () => {
    const totals = sessionTotals([
      { exercise: bench, sets: [set(100, 5)] },
      {
        exercise: { unilateral: false, muscles: [{ muscle: 'triceps', fraction: 1 }] },
        sets: [set(40, 12)],
      },
    ]);
    expect(totals.volumeKg).toBe(980);
    expect(totals.volumeKgByMuscle['triceps']).toBe(250 + 480);
  });

  it('lets an exercise override the session bodyweight context', () => {
    const dip = {
      exercise: { unilateral: false, muscles: [{ muscle: 'chest', fraction: 1 }] },
      sets: [
        {
          type: 'working',
          state: 'completed',
          load: { kind: 'bodyweight', addedWeightKg: 20 },
          effort: { kind: 'reps', reps: 5 },
        } satisfies PerformedSet,
      ],
    };
    expect(sessionTotals([dip], { bodyweightKg: 80 }).volumeKg).toBe(500);
    expect(sessionTotals([{ ...dip, context: { bodyweightKg: 90 } }], { bodyweightKg: 80 }).volumeKg).toBe(550);
  });

  it('is all zeroes for an empty session rather than throwing', () => {
    const totals = sessionTotals([]);
    expect(totals).toEqual({
      exerciseCount: 0,
      setCount: 0,
      workingSetCount: 0,
      completedSetCount: 0,
      failedSetCount: 0,
      volumeKg: 0,
      volumeKgByMuscle: {},
    });
  });

  it('skips a set whose load cannot be resolved instead of dropping the whole fold', () => {
    const totals = sessionTotals([
      {
        exercise: bench,
        sets: [
          {
            type: 'working',
            state: 'completed',
            load: { kind: 'bodyweight', addedWeightKg: 0 },
            effort: { kind: 'reps', reps: 10 },
          },
          set(100, 5),
        ],
      },
    ]);
    expect(totals.completedSetCount).toBe(2);
    expect(totals.volumeKg).toBe(500);
  });
});
