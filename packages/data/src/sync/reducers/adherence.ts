import type {
  AdherenceAggregate,
  AggregateEvent,
  AggregateReducer,
  AggregateReduceResult,
  StreakState,
  WeeklyAdherenceBucket,
} from '../../aggregates.js';
import { AGGREGATE_RETENTION_WEEKS, AGGREGATE_VERSIONS } from '../../aggregates.js';
import type { HabitId } from '../../common/ids.js';
import type { IsoWeek, LocalDate } from '../../common/time.js';
import { foldWorkout } from '../contribution.js';
import { round } from '../contribution.js';
import { addDays, compareLocalDates, streaksOf } from '../week.js';
import { hasInternal, needsRebuild, sortedKeys, unchanged, without } from './internal.js';

/**
 * Adherence: streaks, the calendar heatmap, planned-vs-done per week.
 *
 * Internal collections: one slim record per completed session, and per habit day
 * the ids of habits marked done. Both are bounded by the retention window, which
 * slides with the newest data rather than the clock.
 *
 * Two definitions worth stating because they are judgement calls:
 *
 * - `plannedSessions` counts sessions started from a routine (`programRef`
 *   present). A week's plan that was never opened leaves no document to count, so
 *   "planned" here means "planned and attempted" — honest about what the data can
 *   know without inventing schedule inference.
 * - `prescriptionCompliance` is completed prescribed sets over prescribed sets,
 *   across the week's programmed sessions; null when nothing carried a target.
 *
 * `StreakState.timeZone` stays null in v1: streaks are computed on the local-date
 * strings the documents already carry, so no zone is consulted — the field is
 * reserved for a future reducer version that needs one.
 */

interface SessionAdherence {
  readonly localDate: LocalDate;
  readonly week: IsoWeek;
  readonly hasProgram: boolean;
  readonly prescribedSetCount: number;
  readonly completedPrescribedSetCount: number;
}

interface AdherenceInternal extends AdherenceAggregate {
  readonly _sessions: Readonly<Record<string, SessionAdherence>>;
  /** Per habit-day document id (the local date): habits marked done that day. */
  readonly _habitDone: Readonly<Record<string, readonly HabitId[]>>;
}

const RETENTION_DAYS = AGGREGATE_RETENTION_WEEKS.adherence * 7;

const NO_STREAK: StreakState = {
  currentDays: 0,
  longestDays: 0,
  lastQualifyingDate: null,
  timeZone: null,
};

function streakOf(dates: readonly string[]): StreakState {
  if (dates.length === 0) return NO_STREAK;
  const { currentDays, longestDays, lastQualifyingDate } = streaksOf(dates);
  return { currentDays, longestDays, lastQualifyingDate, timeZone: null };
}

function derive(
  sessions: Readonly<Record<string, SessionAdherence>>,
  habitDone: Readonly<Record<string, readonly HabitId[]>>,
): AdherenceInternal {
  // Retention slides with the newest date across both sources.
  let maxDate: string | null = null;
  for (const id of Object.keys(sessions)) {
    const date = (sessions[id] as SessionAdherence).localDate;
    if (maxDate === null || compareLocalDates(date, maxDate) > 0) maxDate = date;
  }
  for (const date of Object.keys(habitDone)) {
    if (maxDate === null || compareLocalDates(date, maxDate) > 0) maxDate = date;
  }
  const cutoff = maxDate === null ? null : addDays(maxDate, -RETENTION_DAYS);

  const keptSessions: Record<string, SessionAdherence> = {};
  for (const id of sortedKeys(sessions)) {
    const session = sessions[id] as SessionAdherence;
    if (cutoff === null || compareLocalDates(session.localDate, cutoff) >= 0) {
      keptSessions[id] = session;
    }
  }
  const keptHabitDone: Record<string, readonly HabitId[]> = {};
  for (const date of sortedKeys(habitDone)) {
    if (cutoff === null || compareLocalDates(date, cutoff) >= 0) {
      keptHabitDone[date] = habitDone[date] as readonly HabitId[];
    }
  }

  const activeDateSet = new Set<string>();
  const byWeek = new Map<IsoWeek, SessionAdherence[]>();
  for (const id of sortedKeys(keptSessions)) {
    const session = keptSessions[id] as SessionAdherence;
    activeDateSet.add(session.localDate);
    const bucket = byWeek.get(session.week) ?? [];
    bucket.push(session);
    byWeek.set(session.week, bucket);
  }
  const activeDates = [...activeDateSet].sort() as LocalDate[];

  const weeks: WeeklyAdherenceBucket[] = [...byWeek.keys()].sort().map((week) => {
    const bucket = byWeek.get(week) as SessionAdherence[];
    let planned = 0;
    let prescribed = 0;
    let completedPrescribed = 0;
    for (const session of bucket) {
      if (session.hasProgram) planned += 1;
      prescribed += session.prescribedSetCount;
      completedPrescribed += session.completedPrescribedSetCount;
    }
    return {
      week,
      plannedSessions: planned,
      completedSessions: bucket.length,
      prescriptionCompliance: prescribed === 0 ? null : round(completedPrescribed / prescribed),
    };
  });

  const perHabit = new Map<HabitId, string[]>();
  for (const date of sortedKeys(keptHabitDone)) {
    for (const habitId of keptHabitDone[date] as readonly HabitId[]) {
      const dates = perHabit.get(habitId) ?? [];
      dates.push(date);
      perHabit.set(habitId, dates);
    }
  }
  const habitStreaks: Record<HabitId, StreakState> = {};
  for (const habitId of [...perHabit.keys()].sort()) {
    habitStreaks[habitId] = streakOf(perHabit.get(habitId) as string[]);
  }

  return {
    kind: 'adherence',
    trainingStreak: streakOf(activeDates),
    weeks,
    habitStreaks,
    activeDates,
    _sessions: keptSessions,
    _habitDone: keptHabitDone,
  };
}

function reduce(
  state: AdherenceAggregate,
  event: AggregateEvent,
): AggregateReduceResult<'adherence'> {
  if (event.kind !== 'workout' && event.kind !== 'habitDay') return unchanged(state);
  if (!hasInternal(state, '_sessions') || !hasInternal(state, '_habitDone')) {
    return needsRebuild(state, event.id, 'state has no per-source index');
  }
  const internal = state as AdherenceInternal;
  try {
    if (event.kind === 'workout') {
      const sessions = without(internal._sessions, event.id);
      const fold = event.next === null ? null : foldWorkout(event.next);
      if (fold === null) return { state: derive(sessions, internal._habitDone), dropped: [] };
      const session: SessionAdherence = {
        localDate: fold.localDate,
        week: fold.week,
        hasProgram: fold.hasProgram,
        prescribedSetCount: fold.prescribedSetCount,
        completedPrescribedSetCount: fold.completedPrescribedSetCount,
      };
      return {
        state: derive({ ...sessions, [event.id]: session }, internal._habitDone),
        dropped: [],
      };
    }
    const habitDone = without(internal._habitDone, event.id);
    if (event.next === null) return { state: derive(internal._sessions, habitDone), dropped: [] };
    const done = event.next.entries
      .filter((entry) => entry.status === 'done')
      .map((entry) => entry.habitId)
      .sort();
    if (done.length === 0) return { state: derive(internal._sessions, habitDone), dropped: [] };
    return {
      state: derive(internal._sessions, { ...habitDone, [event.id]: done }),
      dropped: [],
    };
  } catch (error) {
    return { state, dropped: [{ id: event.id, reason: String(error) }] };
  }
}

export const adherenceReducer: AggregateReducer<'adherence'> = {
  id: 'adherence',
  version: AGGREGATE_VERSIONS.adherence,
  handles: ['workout', 'habitDay'],
  empty: () => derive({}, {}),
  reduce,
  rebuild: (snapshot) => {
    const sessions: Record<string, SessionAdherence> = {};
    for (const workout of snapshot.workouts) {
      const fold = foldWorkout(workout);
      if (fold === null) continue;
      sessions[workout.id] = {
        localDate: fold.localDate,
        week: fold.week,
        hasProgram: fold.hasProgram,
        prescribedSetCount: fold.prescribedSetCount,
        completedPrescribedSetCount: fold.completedPrescribedSetCount,
      };
    }
    const habitDone: Record<string, readonly HabitId[]> = {};
    for (const day of snapshot.habitDays) {
      const done = day.entries
        .filter((entry) => entry.status === 'done')
        .map((entry) => entry.habitId)
        .sort();
      if (done.length > 0) habitDone[day.id] = done;
    }
    return derive(sessions, habitDone);
  },
};
