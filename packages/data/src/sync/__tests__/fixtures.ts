import type {
  HabitDay,
  MacroTarget,
  NutritionDay,
  PersonalRecord,
  Workout,
} from '../../index.js';
import {
  habitDaySchema,
  macroTargetSchema,
  nutritionDaySchema,
  personalRecordSchema,
  workoutSchema,
} from '../../index.js';

/**
 * Typed document factories for the sync tests. Every fixture round-trips
 * through the real Zod schema, so an invalid fixture fails the suite instead of
 * quietly testing the reducers against documents production could never hold.
 */

export const UID = 'testUserAAAAAAAAAAAAAAAAAAAA';
const TIME = { seconds: 0, nanoseconds: 0 };
const ENVELOPE = { sv: 1, uid: UID, createdAt: TIME, updatedAt: TIME };

export interface SetSpec {
  readonly id: string;
  readonly type?: 'warmup' | 'working' | 'top' | 'drop' | 'amrap';
  readonly state?: 'pending' | 'completed' | 'failed';
  readonly weightKg?: number;
  readonly reps?: number;
  readonly load?: Record<string, unknown>;
  readonly target?: Record<string, unknown>;
}

export interface ExerciseSpec {
  readonly id: string;
  readonly exerciseId?: string;
  readonly name?: string;
  readonly muscles?: readonly { muscle: string; fraction: number }[];
  readonly unilateral?: boolean;
  readonly variantId?: string;
  readonly sets: readonly SetSpec[];
}

export function makeWorkout(spec: {
  id: string;
  localDate: string;
  status?: 'in_progress' | 'completed' | 'discarded';
  bodyweightKg?: number;
  programRef?: { routineId: string; programDayId: string; weekIndex: number };
  exercises: readonly ExerciseSpec[];
}): Workout {
  const status = spec.status ?? 'completed';
  const startedAt = 1_787_000_000_000;
  const raw = {
    ...ENVELOPE,
    id: spec.id,
    status,
    title: 'Session',
    startedAt,
    ...(status === 'in_progress' ? {} : { endedAt: startedAt + 3_600_000 }),
    localDate: spec.localDate,
    tzOffsetMinutes: 0,
    ...(spec.bodyweightKg !== undefined ? { bodyweightKg: spec.bodyweightKg } : {}),
    ...(spec.programRef !== undefined ? { programRef: spec.programRef } : {}),
    exercises: spec.exercises.map((exercise, exerciseIndex) => ({
      id: exercise.id,
      sortKey: sortKeyAt(exerciseIndex),
      exercise: {
        source: 'catalogue',
        exerciseId: exercise.exerciseId ?? 'bench_press',
        ...(exercise.variantId !== undefined ? { variantId: exercise.variantId } : {}),
        name: exercise.name ?? 'Bench Press',
        loadKind: 'external',
        effortKind: 'reps',
        muscles: exercise.muscles ?? [{ muscle: 'chest', fraction: 1 }],
        unilateral: exercise.unilateral ?? false,
      },
      sets: exercise.sets.map((set, setIndex) => ({
        id: set.id,
        sortKey: sortKeyAt(setIndex),
        type: set.type ?? 'working',
        state: set.state ?? 'completed',
        load: set.load ?? { kind: 'external', weightKg: set.weightKg ?? 100 },
        effort: { kind: 'reps', reps: set.reps ?? 5 },
        ...(set.target !== undefined ? { target: set.target } : {}),
        ...((set.state ?? 'completed') === 'pending' ? {} : { performedAt: startedAt + 60_000 }),
      })),
    })),
    totals: {
      exerciseCount: spec.exercises.length,
      setCount: spec.exercises.reduce((n, e) => n + e.sets.length, 0),
      workingSetCount: 0,
      completedSetCount: 0,
      failedSetCount: 0,
      volumeKg: 0,
      volumeKgByMuscle: {},
      durationSec: 3600,
    },
  };
  return workoutSchema.parse(raw);
}

const SORT_DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function sortKeyAt(index: number): string {
  return SORT_DIGITS[index % SORT_DIGITS.length] as string;
}

export function makeNutritionDay(spec: {
  localDate: string;
  energyKcal?: number;
  proteinG?: number;
  entryCount?: number;
  targetSnapshot?: { energyKcal: number; proteinG: number; carbsG: number; fatG: number };
  meals?: readonly {
    id: string;
    entries: readonly { id: string; energyKcal: number; proteinG?: number }[];
  }[];
}): NutritionDay {
  const meals = (spec.meals ?? []).map((meal, mealIndex) => ({
    id: meal.id,
    sortKey: sortKeyAt(mealIndex),
    slot: 'lunch',
    entries: meal.entries.map((entry, entryIndex) => ({
      id: entry.id,
      sortKey: sortKeyAt(entryIndex),
      food: { source: 'bundled', foodId: 'oats', name: 'Oats' },
      quantity: 1,
      serving: { name: 'bowl', gramsPerServing: 100 },
      massG: 100,
      nutrients: {
        energyKcal: entry.energyKcal,
        proteinG: entry.proteinG ?? 0,
        carbsG: 0,
        fatG: 0,
      },
      loggedAt: 1_787_000_000_000,
    })),
    totals: {
      energyKcal: meal.entries.reduce((n, e) => n + e.energyKcal, 0),
      proteinG: meal.entries.reduce((n, e) => n + (e.proteinG ?? 0), 0),
      carbsG: 0,
      fatG: 0,
    },
  }));
  const entryCount = spec.entryCount ?? meals.reduce((n, m) => n + m.entries.length, 0);
  const raw = {
    ...ENVELOPE,
    id: spec.localDate,
    localDate: spec.localDate,
    tzOffsetMinutes: 0,
    meals,
    totals: {
      energyKcal:
        spec.energyKcal ?? meals.reduce((n, m) => n + m.totals.energyKcal, 0),
      proteinG: spec.proteinG ?? meals.reduce((n, m) => n + m.totals.proteinG, 0),
      carbsG: 0,
      fatG: 0,
    },
    entryCount,
    waterMl: 0,
    ...(spec.targetSnapshot !== undefined ? { targetSnapshot: spec.targetSnapshot } : {}),
  };
  return nutritionDaySchema.parse(raw);
}

export function makeMacroTarget(spec: {
  id: string;
  effectiveFrom: string;
  energyKcal: number;
  proteinG: number;
}): MacroTarget {
  return macroTargetSchema.parse({
    ...ENVELOPE,
    id: spec.id,
    effectiveFrom: spec.effectiveFrom,
    status: 'active',
    values: { energyKcal: spec.energyKcal, proteinG: spec.proteinG, carbsG: 200, fatG: 70 },
    source: 'manual',
  });
}

export function makeHabitDay(spec: {
  localDate: string;
  entries: readonly { habitId: string; status: 'pending' | 'done' | 'skipped' | 'missed' }[];
}): HabitDay {
  return habitDaySchema.parse({
    ...ENVELOPE,
    id: spec.localDate,
    localDate: spec.localDate,
    tzOffsetMinutes: 0,
    entries: spec.entries.map((entry) => ({
      habitId: entry.habitId,
      status: entry.status,
      ...(entry.status === 'done' ? { completedAt: 1_787_000_000_000 } : {}),
    })),
  });
}

export function makePersonalRecord(spec: {
  id: string;
  achievements: readonly {
    type: string;
    value: number;
    achievedAt: number;
    achievedOn: string;
    workoutId: string;
  }[];
}): PersonalRecord {
  const history = spec.achievements.map((a) => ({
    type: a.type,
    value: a.value,
    achievedOn: a.achievedOn,
    achievedAt: a.achievedAt,
    workoutId: a.workoutId,
  }));
  const current: Record<string, unknown> = {};
  for (const achievement of history) {
    const existing = current[achievement.type] as { value: number } | undefined;
    if (existing === undefined || achievement.value > existing.value) {
      current[achievement.type] = achievement;
    }
  }
  return personalRecordSchema.parse({
    ...ENVELOPE,
    id: spec.id,
    exercise: {
      source: 'catalogue',
      exerciseId: spec.id,
      name: 'Bench Press',
      loadKind: 'external',
      effortKind: 'reps',
      muscles: [{ muscle: 'chest', fraction: 1 }],
      unilateral: false,
    },
    current,
    repMaxKgByReps: {},
    history,
  });
}

export function emptySnapshot(): {
  workouts: Workout[];
  routines: never[];
  personalRecords: PersonalRecord[];
  bodyMetrics: never[];
  nutritionDays: NutritionDay[];
  macroTargets: MacroTarget[];
  habits: never[];
  habitDays: HabitDay[];
  timeZone: string;
} {
  return {
    workouts: [],
    routines: [],
    personalRecords: [],
    bodyMetrics: [],
    nutritionDays: [],
    macroTargets: [],
    habits: [],
    habitDays: [],
    timeZone: 'UTC',
  };
}
