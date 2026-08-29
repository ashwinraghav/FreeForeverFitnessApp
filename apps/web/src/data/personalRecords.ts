import type {
  EpochMillis,
  FirestoreTimestampLike,
  LocalDate,
  PersonalRecord,
  PersonalRecordId,
  PrAchievement,
  PrCurrentMap,
  PrType,
  UserId,
  Workout,
  WorkoutId,
} from '@freeforever/data';
import { MAX_PR_HISTORY, exerciseKey } from '@freeforever/data';
import { detectRecords, type CandidateSet, type CurrentBests, type RepMaxes } from '@freeforever/core';
import { toPerformedEntry } from './workoutDocuments';

/**
 * Personal records, derived on device from the session history.
 *
 * The other four aggregates rebuild from `workouts`, which the device has. This one
 * does not: `personalRecordsReducer.rebuild` reads `snapshot.personalRecords`, one
 * document per exercise key, and **nothing on this device writes those documents**.
 * The workout feature stores finished sessions and stops there; the write layer that
 * would emit a `personalRecords` document lives in `packages/data/src/sync` and is
 * not wired to a backend yet.
 *
 * So the choice was: leave the PR timeline permanently empty — the exact failure this
 * work exists to fix — or reconstruct the documents the reducer wants from the data
 * the device actually has. This does the second, and it does it through
 * `detectRecords` from `@freeforever/core`, which is the same detection the sync
 * write path uses. Nothing here decides what a record *is*; it only replays the
 * sessions in order and keeps what the detector reports.
 *
 * Two consequences worth being explicit about:
 *
 * - Records are only as deep as the local history, which `workoutStore.ts` caps at
 *   `MAX_LOCAL_HISTORY` sessions. A record set before that window falls out of the
 *   replay, so the next matching set is reported as a first record rather than as
 *   beating one. Server-side history would fix this; nothing local can.
 * - Replay is chronological by `startedAt`. Two sessions with the same start instant
 *   are ordered by id so the fold stays deterministic.
 *
 * When the sync engine lands and real `personalRecords` documents arrive, this module
 * is replaced by reading them — the reducer above it does not change.
 */

const LOCAL_UID = 'local' as UserId;

function timestampOf(epochMs: number): FirestoreTimestampLike {
  return { seconds: Math.floor(epochMs / 1000), nanoseconds: 0 };
}

interface RecordAccumulator {
  readonly exercise: Workout['exercises'][number]['exercise'];
  current: PrCurrentMap;
  bests: CurrentBests;
  repMaxes: RepMaxes;
  history: PrAchievement[];
  lastAchievedOn: LocalDate | null;
}

/** `RepMaxes` is partial; the document field is not. Drop the holes. */
function concreteRepMaxes(repMaxes: RepMaxes): Record<string, number> {
  const out: Record<string, number> = {};
  for (const reps of Object.keys(repMaxes).sort()) {
    const value = repMaxes[reps];
    if (value !== undefined) out[reps] = value;
  }
  return out;
}

/** Sessions oldest first, with a total order so the replay is reproducible. */
function chronologically(workouts: readonly Workout[]): Workout[] {
  return [...workouts].sort(
    (left, right) =>
      left.startedAt - right.startedAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}

/**
 * When a record happened.
 *
 * A set-scoped record is dated by the set that set it. A session-scoped one
 * (`best_session_volume`) belongs to no single set, so it is dated by the end of the
 * session — never by the clock, which would make the fold impure.
 */
function achievedAtOf(workout: Workout, setId: string | undefined): EpochMillis {
  if (setId !== undefined) {
    for (const exercise of workout.exercises) {
      for (const set of exercise.sets) {
        if (set.id === setId && set.performedAt !== undefined) return set.performedAt;
      }
    }
  }
  return (workout.endedAt ?? workout.startedAt) as EpochMillis;
}

/**
 * Replay the local history into the `personalRecords` documents the reducer reads.
 *
 * Pure: same sessions in, same documents out, no clock and no storage.
 */
export function derivePersonalRecords(workouts: readonly Workout[]): PersonalRecord[] {
  const byKey = new Map<string, RecordAccumulator>();

  for (const workout of chronologically(workouts)) {
    if (workout.status !== 'completed') continue;
    const context =
      workout.bodyweightKg === undefined ? {} : { bodyweightKg: workout.bodyweightKg };

    for (const exercise of workout.exercises) {
      const key = exerciseKey(exercise.exercise);
      const accumulator: RecordAccumulator = byKey.get(key) ?? {
        exercise: exercise.exercise,
        current: {},
        bests: {},
        repMaxes: {},
        history: [],
        lastAchievedOn: null,
      };
      byKey.set(key, accumulator);

      const candidates: CandidateSet[] = exercise.sets.map((set) => ({
        ...toPerformedEntry(set),
        setId: set.id,
      }));

      const { achievements, repMaxKgByReps } = detectRecords(
        candidates,
        accumulator.bests,
        accumulator.repMaxes,
        context,
      );

      for (const key_ of Object.keys(repMaxKgByReps)) {
        const value = repMaxKgByReps[key_];
        if (value !== undefined) accumulator.repMaxes[key_] = value;
      }

      for (const detection of achievements) {
        const achievement: PrAchievement = {
          type: detection.type as PrType,
          value: detection.value,
          ...(detection.loadKg === undefined ? {} : { loadKg: detection.loadKg }),
          ...(detection.reps === undefined ? {} : { reps: detection.reps }),
          ...(detection.durationSec === undefined ? {} : { durationSec: detection.durationSec }),
          ...(detection.distanceM === undefined ? {} : { distanceM: detection.distanceM }),
          ...(detection.e1rmKg === undefined ? {} : { e1rmKg: detection.e1rmKg }),
          achievedOn: workout.localDate,
          achievedAt: achievedAtOf(workout, detection.setId),
          workoutId: workout.id as WorkoutId,
          ...(detection.setId === undefined ? {} : { setId: detection.setId as PrAchievement['setId'] }),
          ...(detection.previousValue === undefined
            ? {}
            : { previousValue: detection.previousValue }),
        };
        accumulator.current[achievement.type] = achievement;
        accumulator.bests[achievement.type] = achievement.value;
        accumulator.history.push(achievement);
        accumulator.lastAchievedOn = workout.localDate;
      }
    }
  }

  const documents: PersonalRecord[] = [];
  for (const key of [...byKey.keys()].sort()) {
    const accumulator = byKey.get(key) as RecordAccumulator;
    if (accumulator.history.length === 0) continue;
    const last = accumulator.history[accumulator.history.length - 1] as PrAchievement;
    documents.push({
      sv: 1,
      uid: LOCAL_UID,
      createdAt: timestampOf(accumulator.history[0]?.achievedAt ?? last.achievedAt),
      updatedAt: timestampOf(last.achievedAt),
      id: key as PersonalRecordId,
      exercise: accumulator.exercise,
      current: accumulator.current,
      repMaxKgByReps: concreteRepMaxes(accumulator.repMaxes),
      // Oldest first, capped, matching `personalRecordSchema`.
      history: accumulator.history.slice(-MAX_PR_HISTORY),
      ...(accumulator.lastAchievedOn === null
        ? {}
        : { lastAchievedOn: accumulator.lastAchievedOn }),
    });
  }
  return documents;
}
