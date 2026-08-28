import type {
  AdherenceAggregate,
  ExerciseProgressAggregate,
  IsoWeek,
  LocalDate,
  MuscleGroup,
  PersonalRecordsAggregate,
  PrAchievement,
  TrainingVolumeAggregate,
  WorkoutId,
} from '@freeforever/data';
import type { BodyMetricPoint, BodyMetricsAggregate } from './proposed';
import type { InsightsSnapshot } from './ports';
import { FALLBACK_UNIT_PREFERENCES } from '../select/constants';
import { addDays, formatLocalDate, isoWeekOfDate, parseLocalDate, weekWindow } from '../select/weeks';

/**
 * Deterministic fixtures.
 *
 * Seeded rather than random so a failing chart test fails the same way twice, and so
 * a screenshot taken today matches one taken next week. No clock is read anywhere in
 * here — `today` is an argument, which is the same discipline the selectors follow.
 */

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPLIT: Readonly<Record<string, Partial<Record<MuscleGroup, number>>>> = {
  push: { chest: 1, front_delts: 0.6, side_delts: 0.4, triceps: 0.7 },
  pull: { lats: 1, upper_back: 0.8, rear_delts: 0.5, biceps: 0.7, forearms: 0.3 },
  legs: { quads: 1, hamstrings: 0.7, glutes: 0.8, calves: 0.5, adductors: 0.3, lower_back: 0.4 },
};

export function trainingVolumeFixture(today: LocalDate, weeks = 26): TrainingVolumeAggregate {
  const random = mulberry32(20260828);
  const todayDate = parseLocalDate(today) ?? new Date(0);
  const axis = weekWindow(isoWeekOfDate(todayDate), weeks);

  const buckets = axis.map((week, index) => {
    // One deload week in four, so the chart has the shape a real block has.
    const deload = index % 8 === 7;
    const sessions = deload ? 2 : 3 + (random() > 0.75 ? 1 : 0);
    const setsPerSession = deload ? 12 : 16 + Math.round(random() * 4);
    const setsByMuscle: Partial<Record<MuscleGroup, number>> = {};
    const volumeKgByMuscle: Partial<Record<MuscleGroup, number>> = {};

    for (let session = 0; session < sessions; session += 1) {
      const day = ['push', 'pull', 'legs'][session % 3] ?? 'push';
      for (const [muscle, fraction] of Object.entries(SPLIT[day] ?? {})) {
        if (fraction === undefined) continue;
        const key = muscle as MuscleGroup;
        const sets = Math.round((setsPerSession / 4) * fraction);
        setsByMuscle[key] = (setsByMuscle[key] ?? 0) + sets;
        volumeKgByMuscle[key] = Math.round(
          (volumeKgByMuscle[key] ?? 0) + sets * (60 + random() * 40) * 8,
        );
      }
    }

    const workingSetCount = sessions * setsPerSession;
    return {
      week,
      sessionCount: sessions,
      workingSetCount,
      failedSetCount: Math.round(random() * 2),
      volumeKg: Object.values(volumeKgByMuscle).reduce((sum, value) => sum + (value ?? 0), 0),
      durationSec: sessions * (3300 + Math.round(random() * 900)),
      volumeKgByMuscle,
      setsByMuscle,
      sessionIds: Array.from({ length: sessions }, (_, i) => `${week}-${i}` as WorkoutId),
    };
  });

  return { kind: 'training_volume', weeks: buckets, monthlyVolumeKg: {} };
}

export function exerciseProgressFixture(today: LocalDate): ExerciseProgressAggregate {
  const random = mulberry32(7717);
  const todayDate = parseLocalDate(today) ?? new Date(0);

  const build = (
    exerciseKey: string,
    displayName: string,
    startKg: number,
    gainPerWeek: number,
  ) => {
    const points = Array.from({ length: 24 }, (_, index) => {
      const date = addDays(todayDate, -(23 - index) * 7 - 2);
      const noise = (random() - 0.5) * 4;
      const e1rm = Math.round((startKg + gainPerWeek * index + noise) * 10) / 10;
      const reps = 3 + Math.round(random() * 5);
      return {
        localDate: formatLocalDate(date),
        workoutId: `${exerciseKey}-${index}` as WorkoutId,
        e1rmKg: e1rm,
        topSetLoadKg: Math.round(e1rm * (1 - reps * 0.025) * 2) / 2,
        topSetReps: reps,
        totalVolumeKg: Math.round(e1rm * reps * 3),
        workingSetCount: 3 + (random() > 0.6 ? 1 : 0),
      };
    });
    return {
      exerciseKey,
      exerciseId: exerciseKey as never,
      displayName,
      points,
      lastPerformedOn: points[points.length - 1]?.localDate ?? null,
    };
  };

  return {
    kind: 'exercise_progress',
    series: [
      build('back-squat', 'Back squat', 120, 1.1),
      build('bench-press', 'Bench press', 85, 0.6),
      build('deadlift', 'Deadlift', 150, 1.4),
      build('overhead-press', 'Overhead press', 55, 0.35),
    ],
  };
}

export function personalRecordsFixture(
  progress: ExerciseProgressAggregate,
): PersonalRecordsAggregate {
  const byExerciseKey: Record<string, PrAchievement[]> = {};

  for (const series of progress.series) {
    let best = 0;
    const achievements: PrAchievement[] = [];
    for (const point of series.points) {
      if (point.e1rmKg <= best) continue;
      const date = parseLocalDate(point.localDate);
      achievements.push({
        type: 'best_e1rm',
        value: point.e1rmKg,
        loadKg: point.topSetLoadKg,
        reps: point.topSetReps,
        e1rmKg: point.e1rmKg,
        achievedOn: point.localDate,
        achievedAt: (date?.getTime() ?? 0) as never,
        workoutId: point.workoutId,
        ...(best > 0 ? { previousValue: best } : {}),
      });
      best = point.e1rmKg;
    }
    byExerciseKey[series.exerciseKey] = achievements;
  }

  const flat = Object.values(byExerciseKey)
    .flat()
    .sort((a, b) => b.achievedAt - a.achievedAt);

  return { kind: 'personal_records', achievements: flat, byExerciseKey };
}

export function adherenceFixture(today: LocalDate, weeks = 26): AdherenceAggregate {
  const random = mulberry32(31415);
  const todayDate = parseLocalDate(today) ?? new Date(0);
  const activeDates: LocalDate[] = [];
  const buckets: AdherenceAggregate['weeks'][number][] = [];

  const axis = weekWindow(isoWeekOfDate(todayDate), weeks);
  const todayWeekday = (todayDate.getUTCDay() + 6) % 7;

  axis.forEach((week, index) => {
    const monday = addDays(todayDate, -todayWeekday - (axis.length - 1 - index) * 7);
    const planned = 4;
    let completed = 0;
    for (const weekday of [0, 2, 4, 5]) {
      const day = addDays(monday, weekday);
      if (day.getTime() > todayDate.getTime()) continue;
      if (random() > 0.22) {
        activeDates.push(formatLocalDate(day));
        completed += 1;
      }
    }
    buckets.push({
      week,
      plannedSessions: planned,
      completedSessions: completed,
      prescriptionCompliance: Math.round((0.7 + random() * 0.3) * 100) / 100,
    });
  });

  const sorted = [...activeDates].sort();
  let current = 0;
  const last = sorted[sorted.length - 1];
  if (last !== undefined) {
    let cursor = parseLocalDate(last);
    const present = new Set(sorted);
    while (cursor !== null && present.has(formatLocalDate(cursor))) {
      current += 1;
      cursor = addDays(cursor, -1);
    }
  }

  return {
    kind: 'adherence',
    trainingStreak: {
      currentDays: current,
      longestDays: Math.max(current, 9),
      lastQualifyingDate: last ?? null,
      timeZone: 'Europe/London',
    },
    weeks: buckets,
    habitStreaks: {},
    activeDates: sorted,
  };
}

export function bodyMetricsFixture(today: LocalDate, days = 180): BodyMetricsAggregate {
  const random = mulberry32(2718);
  const todayDate = parseLocalDate(today) ?? new Date(0);
  const points: BodyMetricPoint[] = [];
  let weight = 84;

  for (let offset = days; offset >= 0; offset -= 1) {
    // Nobody weighs in every day, and the smoother has to survive the gaps.
    if (random() > 0.55) continue;
    weight += (random() - 0.55) * 0.35;
    const date = addDays(todayDate, -offset);
    points.push({
      localDate: formatLocalDate(date),
      weightKg: Math.round((weight + (random() - 0.5) * 1.2) * 10) / 10,
      ...(offset % 14 === 0
        ? {
            measurementsCm: {
              waistCm: Math.round((84 - (days - offset) * 0.01 + random()) * 10) / 10,
              chestCm: Math.round((104 + (days - offset) * 0.005 + random()) * 10) / 10,
            },
          }
        : {}),
    });
  }

  const weeklyMeanWeightKg: Record<string, number> = {};
  for (const point of points) {
    const date = parseLocalDate(point.localDate);
    if (date === null || point.weightKg === undefined) continue;
    const week = isoWeekOfDate(date);
    weeklyMeanWeightKg[week] = point.weightKg;
  }

  return {
    kind: 'body_metrics',
    days: points,
    weeklyMeanWeightKg: weeklyMeanWeightKg as Record<IsoWeek, number>,
    monthlyMeanWeightKg: {},
    measuredSites: ['waistCm', 'chestCm'],
  };
}

/** A fully populated snapshot — the harness every view test renders against. */
export function snapshotFixture(today: LocalDate): InsightsSnapshot {
  const exerciseProgress = exerciseProgressFixture(today);
  return {
    trainingVolume: trainingVolumeFixture(today),
    exerciseProgress,
    personalRecords: personalRecordsFixture(exerciseProgress),
    adherence: adherenceFixture(today),
    bodyMetrics: bodyMetricsFixture(today),
    today,
    timeZone: 'Europe/London',
    units: FALLBACK_UNIT_PREFERENCES,
    rebuilding: false,
  };
}
