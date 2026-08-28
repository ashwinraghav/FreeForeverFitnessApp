import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNIT_PREFERENCES,
  KILOGRAMS_PER_POUND,
  SCHEMA_VERSION,
  coachGrantId,
  coachGrantSchema,
  exerciseKey,
  isRecordEligible,
  isWarmupSet,
  isWorkingSet,
  localDateSchema,
  nutritionDaySchema,
  setEntrySchema,
  unitPreferencesSchema,
  workoutSchema,
} from '../../src/index.js';
import { COLLECTIONS, USER_SUBCOLLECTIONS, paths } from '../../src/collections.js';
import { AGGREGATE_IDS, AGGREGATE_VERSIONS } from '../../src/aggregates.js';
import type { UserId } from '../../src/common/ids.js';

const uid = 'uid-1' as UserId;

const serverTime = { seconds: 1_787_000_000, nanoseconds: 0 };

const aSet = {
  id: 's1',
  sortKey: 'V',
  type: 'working',
  state: 'pending',
  load: { kind: 'external', weightKg: 100 },
  effort: { kind: 'reps', reps: 5 },
};

describe('the set state machine', () => {
  it('accepts a pending set with no performedAt', () => {
    expect(setEntrySchema.safeParse(aSet).success).toBe(true);
  });

  it('rejects a pending set that claims to have been performed', () => {
    expect(
      setEntrySchema.safeParse({ ...aSet, performedAt: 1_787_000_000_000 }).success,
    ).toBe(false);
  });

  it('rejects a completed set with no performedAt', () => {
    expect(setEntrySchema.safeParse({ ...aSet, state: 'completed' }).success).toBe(false);
  });

  it('accepts a failed set, which is real work that set no record', () => {
    const failed = { ...aSet, state: 'failed', performedAt: 1_787_000_000_000 };
    expect(setEntrySchema.safeParse(failed).success).toBe(true);
    expect(isWorkingSet(failed as never)).toBe(true);
    expect(isRecordEligible(failed as never)).toBe(false);
  });

  it('excludes warmups from working sets and from records', () => {
    const warmup = { ...aSet, type: 'warmup', state: 'completed', performedAt: 1_787_000_000_000 };
    expect(isWarmupSet(warmup as never)).toBe(true);
    expect(isWorkingSet(warmup as never)).toBe(false);
    expect(isRecordEligible(warmup as never)).toBe(false);
  });

  it('counts a completed working set as record-eligible', () => {
    const completed = { ...aSet, state: 'completed', performedAt: 1_787_000_000_000 };
    expect(isRecordEligible(completed as never)).toBe(true);
  });

  it('rejects a load shape that mixes two loading modes', () => {
    expect(
      setEntrySchema.safeParse({
        ...aSet,
        load: { kind: 'external', weightKg: 100, assistanceKg: 20 },
      }).success,
    ).toBe(false);
  });

  it('accepts assisted work, where more load is less effort', () => {
    expect(
      setEntrySchema.safeParse({ ...aSet, load: { kind: 'assisted', assistanceKg: 25 } }).success,
    ).toBe(true);
  });

  it('accepts a bodyweight set with added or negative added load', () => {
    for (const addedWeightKg of [0, 20, -5]) {
      expect(
        setEntrySchema.safeParse({ ...aSet, load: { kind: 'bodyweight', addedWeightKg } }).success,
      ).toBe(true);
    }
  });

  it('keeps RPE and RIR on their own scales rather than converting either', () => {
    expect(
      setEntrySchema.safeParse({ ...aSet, effortRating: { scale: 'rpe', value: 8.5 } }).success,
    ).toBe(true);
    expect(
      setEntrySchema.safeParse({ ...aSet, effortRating: { scale: 'rir', value: 2 } }).success,
    ).toBe(true);
    expect(
      setEntrySchema.safeParse({ ...aSet, effortRating: { scale: 'rpe', value: 8.3 } }).success,
    ).toBe(false);
  });
});

const aWorkout = {
  sv: SCHEMA_VERSION,
  uid,
  id: 'w1',
  createdAt: serverTime,
  updatedAt: serverTime,
  status: 'in_progress',
  title: 'Push A',
  startedAt: 1_787_000_000_000,
  localDate: '2026-08-28',
  tzOffsetMinutes: 60,
  exercises: [
    {
      id: 'we1',
      sortKey: 'V',
      exercise: {
        source: 'catalogue',
        exerciseId: 'bench_press',
        name: 'Bench Press',
        loadKind: 'external',
        effortKind: 'reps',
        muscles: [{ muscle: 'chest', fraction: 1 }],
        unilateral: false,
      },
      sets: [aSet],
    },
  ],
  totals: {
    exerciseCount: 1,
    setCount: 1,
    workingSetCount: 1,
    completedSetCount: 0,
    failedSetCount: 0,
    volumeKg: 0,
    volumeKgByMuscle: { chest: 0 },
    durationSec: 0,
  },
};

describe('the workout session', () => {
  it('accepts a session in progress with no end time', () => {
    expect(workoutSchema.safeParse(aWorkout).success).toBe(true);
  });

  it('rejects a completed session with no end time', () => {
    expect(workoutSchema.safeParse({ ...aWorkout, status: 'completed' }).success).toBe(false);
  });

  it('rejects an in-progress session that has already ended', () => {
    expect(
      workoutSchema.safeParse({ ...aWorkout, endedAt: 1_787_000_100_000 }).success,
    ).toBe(false);
  });

  it('rejects a session that ended before it started', () => {
    expect(
      workoutSchema.safeParse({
        ...aWorkout,
        status: 'completed',
        endedAt: aWorkout.startedAt - 1,
      }).success,
    ).toBe(false);
  });

  it('rejects a muscle volume map with a key that is not a muscle', () => {
    expect(
      workoutSchema.safeParse({
        ...aWorkout,
        totals: { ...aWorkout.totals, volumeKgByMuscle: { biceps: 10, vibes: 1 } },
      }).success,
    ).toBe(false);
  });
});

describe('local dates', () => {
  it('accepts real dates', () => {
    for (const value of ['2026-08-28', '2024-02-29', '2026-12-31']) {
      expect(localDateSchema.safeParse(value).success, value).toBe(true);
    }
  });

  it('rejects impossible ones', () => {
    for (const value of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-8-28', '28-08-2026', '']) {
      expect(localDateSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe('nutrition days', () => {
  const aDay = {
    sv: SCHEMA_VERSION,
    uid,
    id: '2026-08-28',
    createdAt: serverTime,
    updatedAt: serverTime,
    localDate: '2026-08-28',
    tzOffsetMinutes: 60,
    meals: [],
    totals: { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    entryCount: 0,
    waterMl: 0,
  };

  it('accepts a day whose id is its local date', () => {
    expect(nutritionDaySchema.safeParse(aDay).success).toBe(true);
  });

  it('rejects a day whose id and local date disagree', () => {
    expect(nutritionDaySchema.safeParse({ ...aDay, id: '2026-08-27' }).success).toBe(false);
  });
});

describe('coach grants', () => {
  const aGrant = {
    sv: SCHEMA_VERSION,
    id: 'owner__coach',
    ownerUid: 'owner',
    coachUid: 'coach',
    status: 'active',
    scopes: ['training'],
    createdAt: serverTime,
    updatedAt: serverTime,
  };

  it('derives its id from the two uids', () => {
    expect(coachGrantId('owner' as UserId, 'coach' as UserId)).toBe('owner__coach');
    expect(coachGrantSchema.safeParse(aGrant).success).toBe(true);
  });

  it('rejects an id that does not match its uids', () => {
    expect(coachGrantSchema.safeParse({ ...aGrant, id: 'coach__owner' }).success).toBe(false);
  });

  it('rejects a self-grant', () => {
    expect(
      coachGrantSchema.safeParse({ ...aGrant, id: 'owner__owner', coachUid: 'owner' }).success,
    ).toBe(false);
  });

  it('rejects a revoked grant that does not say when', () => {
    expect(coachGrantSchema.safeParse({ ...aGrant, status: 'revoked' }).success).toBe(false);
  });

  it('rejects repeated scopes and an empty scope list', () => {
    expect(
      coachGrantSchema.safeParse({ ...aGrant, scopes: ['training', 'training'] }).success,
    ).toBe(false);
    expect(coachGrantSchema.safeParse({ ...aGrant, scopes: [] }).success).toBe(false);
  });
});

describe('units', () => {
  it('defaults to canonical units', () => {
    expect(unitPreferencesSchema.safeParse(DEFAULT_UNIT_PREFERENCES).success).toBe(true);
  });

  it('uses the exact definition of a pound, not a rounded one', () => {
    expect(KILOGRAMS_PER_POUND).toBe(0.45359237);
    expect(225 * KILOGRAMS_PER_POUND).toBeCloseTo(102.058, 3);
  });
});

describe('exercise keys', () => {
  it('separates a variant from its parent, so a paused bench is its own record', () => {
    expect(exerciseKey({ exerciseId: 'bench' as never })).toBe('bench');
    expect(exerciseKey({ exerciseId: 'bench' as never, variantId: 'paused' as never })).toBe(
      'bench~paused',
    );
  });
});

describe('the collection layout', () => {
  it('builds every path from one place', () => {
    expect(paths.profile(uid)).toBe('users/uid-1');
    expect(paths.workout(uid, 'w1' as never)).toBe('users/uid-1/workouts/w1');
    expect(paths.nutritionDay(uid, '2026-08-28' as never)).toBe(
      'users/uid-1/nutritionDays/2026-08-28',
    );
    expect(paths.coachGrant(uid, 'coach' as UserId)).toBe('coachGrants/uid-1__coach');
  });

  it('names every user subcollection in the collection map', () => {
    for (const name of USER_SUBCOLLECTIONS) {
      expect(Object.values(COLLECTIONS)).toContain(name);
    }
  });

  it('versions every aggregate it declares', () => {
    for (const id of AGGREGATE_IDS) {
      expect(AGGREGATE_VERSIONS[id]).toBeGreaterThanOrEqual(1);
    }
  });
});
