import type {
  AggregateEvent,
  AggregateReducer,
  AggregateReduceResult,
  ExerciseProgressAggregate,
  ExerciseProgressPoint,
  ExerciseProgressSeries,
} from '../../aggregates.js';
import { AGGREGATE_VERSIONS } from '../../aggregates.js';
import type { ExerciseId } from '../../common/ids.js';
import type { LocalDate } from '../../common/time.js';
import { foldWorkout } from '../contribution.js';
import { compareLocalDates } from '../week.js';
import { hasInternal, needsRebuild, sortedKeys, unchanged, without } from './internal.js';

/**
 * Per-exercise progress lines: e1RM, top set and session volume over time.
 *
 * Internal collection: per workout id, the point each exercise earned in that
 * session. Series are derived whole. Points are capped per series at
 * {@link MAX_POINTS_PER_SERIES} (newest kept) rather than downsampled to weekly
 * bests: downsampling inside `reduce` would make the state depend on the order
 * points were seen, and the reduce==rebuild property is worth more than the bytes.
 * The one residue: deleting a very old workout that has already been capped away
 * cannot resurrect a sibling point until the next rebuild.
 */

interface WorkoutPoints {
  readonly [exerciseKey: string]: {
    readonly exerciseId: ExerciseId;
    readonly displayName: string;
    readonly point: ExerciseProgressPoint;
  };
}

interface ExerciseProgressInternal extends ExerciseProgressAggregate {
  readonly _byWorkout: Readonly<Record<string, WorkoutPoints>>;
}

export const MAX_POINTS_PER_SERIES = 520;

function derive(byWorkout: Readonly<Record<string, WorkoutPoints>>): ExerciseProgressInternal {
  const collected = new Map<
    string,
    { exerciseId: ExerciseId; displayName: string; lastDate: LocalDate; points: ExerciseProgressPoint[] }
  >();

  for (const workoutId of sortedKeys(byWorkout)) {
    const points = byWorkout[workoutId] as WorkoutPoints;
    for (const key of Object.keys(points).sort()) {
      const entry = points[key];
      if (entry === undefined) continue;
      const series = collected.get(key);
      if (series === undefined) {
        collected.set(key, {
          exerciseId: entry.exerciseId,
          displayName: entry.displayName,
          lastDate: entry.point.localDate,
          points: [entry.point],
        });
      } else {
        series.points.push(entry.point);
        if (compareLocalDates(entry.point.localDate, series.lastDate) >= 0) {
          series.lastDate = entry.point.localDate;
          // The name the user saw most recently is the one the chart shows.
          series.displayName = entry.displayName;
        }
      }
    }
  }

  const series: ExerciseProgressSeries[] = [...collected.keys()].sort().map((key) => {
    const entry = collected.get(key) as NonNullable<ReturnType<typeof collected.get>>;
    const points = entry.points
      .sort(
        (a, b) =>
          compareLocalDates(a.localDate, b.localDate) || (a.workoutId < b.workoutId ? -1 : 1),
      )
      .slice(-MAX_POINTS_PER_SERIES);
    return {
      exerciseKey: key,
      exerciseId: entry.exerciseId,
      displayName: entry.displayName,
      points,
      lastPerformedOn: entry.lastDate,
    };
  });

  return { kind: 'exercise_progress', series, _byWorkout: byWorkout };
}

function reduce(
  state: ExerciseProgressAggregate,
  event: AggregateEvent,
): AggregateReduceResult<'exercise_progress'> {
  if (event.kind !== 'workout') return unchanged(state);
  if (!hasInternal(state, '_byWorkout')) {
    return needsRebuild(state, event.id, 'state has no per-workout index');
  }
  const internal = state as ExerciseProgressInternal;
  try {
    const remaining = without(internal._byWorkout, event.id);
    const fold = event.next === null ? null : foldWorkout(event.next);
    if (fold === null) return { state: derive(remaining), dropped: [] };

    const points: Record<string, WorkoutPoints[string]> = {};
    for (const exercise of fold.exercises) {
      if (exercise.point === null) continue;
      // Two entries of the same exercise in one session merge to the better point.
      const existing = points[exercise.exerciseKey];
      if (existing === undefined || exercise.point.e1rmKg > existing.point.e1rmKg) {
        points[exercise.exerciseKey] = {
          exerciseId: exercise.exerciseId,
          displayName: exercise.displayName,
          point: exercise.point,
        };
      }
    }
    if (Object.keys(points).length === 0) return { state: derive(remaining), dropped: [] };
    return { state: derive({ ...remaining, [event.id]: points }), dropped: [] };
  } catch (error) {
    return { state, dropped: [{ id: event.id, reason: String(error) }] };
  }
}

export const exerciseProgressReducer: AggregateReducer<'exercise_progress'> = {
  id: 'exercise_progress',
  version: AGGREGATE_VERSIONS.exercise_progress,
  handles: ['workout'],
  empty: () => derive({}),
  reduce,
  rebuild: (snapshot) => {
    let state = derive({});
    let sequence = 1;
    for (const workout of snapshot.workouts) {
      state = reduce(state, {
        kind: 'workout',
        id: workout.id,
        previous: null,
        next: workout,
        sequence: sequence++,
      }).state as ExerciseProgressInternal;
    }
    return state;
  },
};
