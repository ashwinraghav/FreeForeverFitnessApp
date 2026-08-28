import { exerciseKey, type ExerciseRef, type LocalDate } from '@freeforever/data';
import {
  effectiveLoadKg,
  estimateOneRepMax,
  tonnageKg,
  type PerformedSet,
} from '@freeforever/core';

import type { DraftExercise, DraftSet, DraftWorkout } from './types.js';

/**
 * "What did I lift last time?"
 *
 * The one question every set on the screen is implicitly answering, and — per the
 * access-pattern table in SCHEMA.md — it is served by the previous `workouts`
 * document already in the local cache. Not a query. This module is the fold that
 * turns those cached sessions into the two things the screen needs: the carried-over
 * numbers for a ghost, and the last three sessions of the current lift.
 */

/** A finished session, as it is read back out of the cache. */
export interface CompletedSession {
  readonly id: string;
  readonly localDate: LocalDate;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly bodyweightKg?: number;
  readonly exercises: readonly DraftExercise[];
}

/** One past outing of a single lift, ready to render as a line of numbers. */
export interface ExerciseHistoryEntry {
  readonly workoutId: string;
  readonly localDate: LocalDate;
  readonly performedAt: number;
  /** Attempted working sets, in order. Warmups and untouched sets are dropped. */
  readonly sets: readonly DraftSet[];
  /** Attempted warmups, in order. Kept separately so a warmup row ghosts off a warmup. */
  readonly warmupSets: readonly DraftSet[];
  readonly topSet: DraftSet | null;
  readonly topLoadKg: number | null;
  readonly volumeKg: number;
  readonly bestE1rmKg: number | null;
  readonly bodyweightKg?: number;
}

/** Sessions are stored newest-last on disk; everything here works newest-first. */
export function byMostRecent(sessions: readonly CompletedSession[]): CompletedSession[] {
  return [...sessions].sort((left, right) => right.startedAt - left.startedAt);
}

/**
 * The last `limit` sessions that contain this exercise, most recent first.
 *
 * Matched on `exerciseKey`, so a paused bench does not show up in a bench history —
 * variants split for exactly the reason PRs split (SCHEMA.md): merging them makes the
 * number meaningless.
 */
export function historyFor(
  ref: Pick<ExerciseRef, 'exerciseId' | 'variantId'>,
  sessions: readonly CompletedSession[],
  limit = 3,
): ExerciseHistoryEntry[] {
  const key = exerciseKey(ref);
  const entries: ExerciseHistoryEntry[] = [];

  for (const session of byMostRecent(sessions)) {
    for (const exercise of session.exercises) {
      if (exerciseKey(exercise.exercise) !== key) continue;
      const entry = summarise(session, exercise);
      if (entry !== null) entries.push(entry);
      break;
    }
    if (entries.length >= limit) break;
  }

  return entries.slice(0, limit);
}

/** The most recent outing of this exercise, or `null` if it has never been done. */
export function lastTimeFor(
  ref: Pick<ExerciseRef, 'exerciseId' | 'variantId'>,
  sessions: readonly CompletedSession[],
): ExerciseHistoryEntry | null {
  return historyFor(ref, sessions, 1)[0] ?? null;
}

/** Turn a finished draft into the history record the next session reads. */
export function toCompletedSession(workout: DraftWorkout): CompletedSession {
  return {
    id: workout.id,
    localDate: workout.localDate,
    startedAt: workout.startedAt,
    ...(workout.endedAt === undefined ? {} : { endedAt: workout.endedAt }),
    ...(workout.bodyweightKg === undefined ? {} : { bodyweightKg: workout.bodyweightKg }),
    exercises: workout.exercises,
  };
}

/**
 * Exercise ids in the order they were last used, most recent first.
 *
 * The picker opens on this. Search over 900 exercises is fast, but the fastest search
 * is the one nobody has to type: most sessions repeat a handful of lifts.
 */
export function recentExerciseIds(sessions: readonly CompletedSession[], limit = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const session of byMostRecent(sessions)) {
    for (const exercise of session.exercises) {
      const id = exercise.exercise.exerciseId;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * A draft set as `@freeforever/core` wants to read it.
 *
 * The draft carries nullable numbers because a half-filled row is a real state; the
 * core's `PerformedSet` does not, because a fold over half-filled rows is a fold over
 * nothing. `null` becomes zero here and *only* here, on the way into a calculation
 * that has already filtered out unattempted sets.
 */
export function toPerformedSet(set: DraftSet): PerformedSet {
  return {
    type: set.type,
    state: set.state,
    load: loadOf(set),
    effort: effortOf(set),
    ...(set.effortRating === undefined ? {} : { effortRating: set.effortRating }),
  };
}

function loadOf(set: DraftSet): PerformedSet['load'] {
  switch (set.loadKind) {
    case 'external':
      return { kind: 'external', weightKg: set.weightKg ?? 0 };
    case 'bodyweight':
      return { kind: 'bodyweight', addedWeightKg: set.weightKg ?? 0 };
    case 'assisted':
      return { kind: 'assisted', assistanceKg: set.weightKg ?? 0 };
    case 'none':
      return { kind: 'none' };
  }
}

function effortOf(set: DraftSet): PerformedSet['effort'] {
  switch (set.effortKind) {
    case 'reps':
      return { kind: 'reps', reps: set.reps ?? 0 };
    case 'duration':
      return { kind: 'duration', durationSec: set.durationSec ?? 0 };
    case 'distance':
      return {
        kind: 'distance',
        distanceM: set.distanceM ?? 0,
        ...(set.durationSec === null ? {} : { durationSec: set.durationSec }),
      };
    case 'reps_and_duration':
      return { kind: 'reps_and_duration', reps: set.reps ?? 0, durationSec: set.durationSec ?? 0 };
  }
}

function summarise(
  session: CompletedSession,
  exercise: DraftExercise,
): ExerciseHistoryEntry | null {
  const inOrder = [...exercise.sets]
    .filter((set) => set.state !== 'pending')
    .sort((left, right) => (left.sortKey < right.sortKey ? -1 : 1));
  const attempted = inOrder.filter((set) => set.type !== 'warmup');
  const warmups = inOrder.filter((set) => set.type === 'warmup');
  if (attempted.length === 0 && warmups.length === 0) return null;

  const context =
    session.bodyweightKg === undefined ? {} : { bodyweightKg: session.bodyweightKg };

  let topSet: DraftSet | null = null;
  let topLoad: number | null = null;
  let bestE1rm: number | null = null;

  for (const set of attempted) {
    const load = effectiveLoadKg(loadOf(set), context);
    if (load !== null && (topLoad === null || load > topLoad)) {
      topLoad = load;
      topSet = set;
    }
    if (load !== null && set.state === 'completed' && set.reps !== null) {
      const estimate = estimateOneRepMax(load, set.reps);
      if (estimate !== null && (bestE1rm === null || estimate > bestE1rm)) bestE1rm = estimate;
    }
  }

  return {
    workoutId: session.id,
    localDate: session.localDate,
    performedAt: session.startedAt,
    sets: attempted,
    warmupSets: warmups,
    topSet,
    topLoadKg: topLoad,
    volumeKg: tonnageKg(attempted.map(toPerformedSet), context),
    bestE1rmKg: bestE1rm,
    ...(session.bodyweightKg === undefined ? {} : { bodyweightKg: session.bodyweightKg }),
  };
}
