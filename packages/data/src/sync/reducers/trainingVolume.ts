import type {
  AggregateEvent,
  AggregateReducer,
  AggregateReduceResult,
  TrainingVolumeAggregate,
  WeeklyVolumeBucket,
} from '../../aggregates.js';
import { AGGREGATE_RETENTION_WEEKS, AGGREGATE_VERSIONS } from '../../aggregates.js';
import type { WorkoutId } from '../../common/ids.js';
import type { IsoWeek, LocalDate } from '../../common/time.js';
import type { MuscleGroup } from '../../schemas/exercise.js';
import { foldWorkout, round } from '../contribution.js';
import { addDays, compareLocalDates, isoMonthOf } from '../week.js';
import { hasInternal, needsRebuild, sortedKeys, unchanged, without } from './internal.js';

/**
 * Weekly training volume, total and per muscle.
 *
 * Internal collection: one slim record per completed session. Weeks inside the
 * retention window keep full detail; older sessions are slimmed to month + total
 * volume and feed only `monthlyVolumeKg`. The window slides with the newest
 * session in the data, not with the clock, so the fold stays a pure function.
 */

interface SessionVolume {
  readonly localDate: LocalDate;
  readonly week: IsoWeek;
  readonly volumeKg: number;
  readonly durationSec: number;
  readonly workingSetCount: number;
  readonly failedSetCount: number;
  readonly volumeKgByMuscle: Partial<Record<MuscleGroup, number>>;
  readonly setsByMuscle: Partial<Record<MuscleGroup, number>>;
}

/** A session outside the retention window: month and total volume only. */
interface ArchivedSession {
  readonly month: string;
  readonly volumeKg: number;
}

interface TrainingVolumeInternal extends TrainingVolumeAggregate {
  readonly _sessions: Readonly<Record<string, SessionVolume>>;
  readonly _archived: Readonly<Record<string, ArchivedSession>>;
}

const RETENTION_DAYS = AGGREGATE_RETENTION_WEEKS.training_volume * 7;

function derive(
  sessions: Readonly<Record<string, SessionVolume>>,
  archived: Readonly<Record<string, ArchivedSession>>,
): TrainingVolumeInternal {
  // The retention window slides with the newest session present.
  let maxDate: string | null = null;
  for (const id of Object.keys(sessions)) {
    const date = (sessions[id] as SessionVolume).localDate;
    if (maxDate === null || compareLocalDates(date, maxDate) > 0) maxDate = date;
  }
  const cutoff = maxDate === null ? null : addDays(maxDate, -RETENTION_DAYS);

  const kept: Record<string, SessionVolume> = {};
  const slimmed: Record<string, ArchivedSession> = { ...archived };
  for (const id of sortedKeys(sessions)) {
    const session = sessions[id] as SessionVolume;
    if (cutoff !== null && compareLocalDates(session.localDate, cutoff) < 0) {
      slimmed[id] = { month: isoMonthOf(session.localDate), volumeKg: session.volumeKg };
    } else {
      kept[id] = session;
    }
  }

  const byWeek = new Map<IsoWeek, { ids: WorkoutId[]; sessions: SessionVolume[] }>();
  for (const id of sortedKeys(kept)) {
    const session = kept[id] as SessionVolume;
    const bucket = byWeek.get(session.week) ?? { ids: [], sessions: [] };
    bucket.ids.push(id as WorkoutId);
    bucket.sessions.push(session);
    byWeek.set(session.week, bucket);
  }

  const weeks: WeeklyVolumeBucket[] = [...byWeek.keys()].sort().map((week) => {
    const bucket = byWeek.get(week) as { ids: WorkoutId[]; sessions: SessionVolume[] };
    const volumeByMuscle: Partial<Record<MuscleGroup, number>> = {};
    const setsByMuscle: Partial<Record<MuscleGroup, number>> = {};
    let volumeKg = 0;
    let durationSec = 0;
    let workingSetCount = 0;
    let failedSetCount = 0;
    for (const session of bucket.sessions) {
      volumeKg += session.volumeKg;
      durationSec += session.durationSec;
      workingSetCount += session.workingSetCount;
      failedSetCount += session.failedSetCount;
      for (const [muscle, value] of Object.entries(session.volumeKgByMuscle) as [
        MuscleGroup,
        number,
      ][]) {
        volumeByMuscle[muscle] = round((volumeByMuscle[muscle] ?? 0) + value);
      }
      for (const [muscle, value] of Object.entries(session.setsByMuscle) as [
        MuscleGroup,
        number,
      ][]) {
        setsByMuscle[muscle] = round((setsByMuscle[muscle] ?? 0) + value);
      }
    }
    return {
      week,
      sessionCount: bucket.sessions.length,
      workingSetCount,
      failedSetCount,
      volumeKg: round(volumeKg),
      durationSec,
      volumeKgByMuscle: volumeByMuscle,
      setsByMuscle,
      sessionIds: bucket.ids,
    };
  });

  const monthly: Record<string, number> = {};
  for (const id of sortedKeys(slimmed)) {
    const entry = slimmed[id] as ArchivedSession;
    monthly[entry.month] = round((monthly[entry.month] ?? 0) + entry.volumeKg);
  }

  return {
    kind: 'training_volume',
    weeks,
    monthlyVolumeKg: monthly,
    _sessions: kept,
    _archived: slimmed,
  };
}

function reduce(
  state: TrainingVolumeAggregate,
  event: AggregateEvent,
): AggregateReduceResult<'training_volume'> {
  if (event.kind !== 'workout') return unchanged(state);
  if (!hasInternal(state, '_sessions') || !hasInternal(state, '_archived')) {
    return needsRebuild(state, event.id, 'state has no per-session index');
  }
  const internal = state as TrainingVolumeInternal;
  try {
    const fold = event.next === null ? null : foldWorkout(event.next);
    const sessions = without(internal._sessions, event.id);
    const archived = without(internal._archived, event.id);
    if (fold === null) {
      return { state: derive(sessions, archived), dropped: [] };
    }
    const contribution: SessionVolume = {
      localDate: fold.localDate,
      week: fold.week,
      volumeKg: fold.volumeKg,
      durationSec: fold.durationSec,
      workingSetCount: fold.workingSetCount,
      failedSetCount: fold.failedSetCount,
      volumeKgByMuscle: fold.volumeKgByMuscle,
      setsByMuscle: fold.setsByMuscle,
    };
    return { state: derive({ ...sessions, [event.id]: contribution }, archived), dropped: [] };
  } catch (error) {
    // One bad row must not take out the insights tab.
    return { state, dropped: [{ id: event.id, reason: String(error) }] };
  }
}

export const trainingVolumeReducer: AggregateReducer<'training_volume'> = {
  id: 'training_volume',
  version: AGGREGATE_VERSIONS.training_volume,
  handles: ['workout'],
  empty: () => derive({}, {}),
  reduce,
  rebuild: (snapshot) => {
    const sessions: Record<string, SessionVolume> = {};
    for (const workout of snapshot.workouts) {
      const fold = foldWorkout(workout);
      if (fold === null) continue;
      sessions[workout.id] = {
        localDate: fold.localDate,
        week: fold.week,
        volumeKg: fold.volumeKg,
        durationSec: fold.durationSec,
        workingSetCount: fold.workingSetCount,
        failedSetCount: fold.failedSetCount,
        volumeKgByMuscle: fold.volumeKgByMuscle,
        setsByMuscle: fold.setsByMuscle,
      };
    }
    return derive(sessions, {});
  },
};
