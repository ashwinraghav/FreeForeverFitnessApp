import { exerciseKey, type ExerciseRef } from '@freeforever/data';
import {
  detectRecords,
  nextPrescription,
  type CandidateSet,
  type CurrentBests,
  type ExerciseSession,
  type LoadContext,
  type Prescription,
  type ProgressionScheme,
  type RecordDetection,
} from '@freeforever/core';

import type { CompletedSession } from './history.js';
import { byMostRecent, toPerformedSet } from './history.js';
import type { DraftExercise, DraftWorkout } from './types.js';

/**
 * The bridge between the pure maths in `@freeforever/core/training` and the screen.
 *
 * Everything here is a fold over sessions already in the local cache. No query, no
 * model, no network — the zero-cost path ADR-0016 requires to exist and to work
 * standalone before anything AI-flavoured is layered over it. The suggestion a lifter
 * sees between sets costs nothing to produce, which is the whole point.
 */

/** Where a rep range starts when the lifter has no history to read. */
export const FALLBACK_REP_RANGE = { min: 8, max: 12 } as const;

/**
 * How far above the lifter's usual rep count the range reaches before load goes up.
 * Two: enough to be a real target, few enough to be reached in a session or two.
 */
export const REP_RANGE_HEADROOM = 2;

/**
 * The default scheme for an exercise the lifter has not configured.
 *
 * Double progression on a rep range, because it is the scheme that fails most safely:
 * it adds a rep before it adds weight, so a bad day costs one rep rather than a missed
 * set, and it works for accessories and main lifts alike.
 *
 * The **range** is not a constant, and that matters more than the scheme. A blanket
 * 8-12 told a lifter running 3x5 to "go for 8" — a rep count they have never trained
 * at — and then read every session as a miss because five is not twelve, until it
 * recommended a 10% deload off the back of a session that set a personal record. A
 * default that has never seen the lift should defer to what the lifter actually does.
 * {@link deriveSchemeFor} reads it off their own history; this is the no-history case.
 */
export function defaultSchemeFor(ref: ExerciseRef, incrementKg: number): ProgressionScheme {
  if (ref.effortKind === 'duration') {
    return { kind: 'time_linear', targetSec: 60, incrementSec: 10 };
  }
  if (ref.effortKind === 'distance') {
    // Distance work has no honest generic progression: further, faster and heavier
    // are three different goals and the app cannot guess which. Hold, and say so.
    return { kind: 'rpe', targetRpe: 8, reps: 1, incrementKg };
  }
  return { kind: 'double', repRange: { ...FALLBACK_REP_RANGE }, incrementKg };
}

/**
 * The default scheme, with its rep range taken from the lifter's own recent sets.
 *
 * The modal completed rep count is the bottom of the range and it reaches
 * {@link REP_RANGE_HEADROOM} above: a lifter doing straight fives is progressed
 * 5 -> 6 -> 7, then load goes up and it resets to 5. Someone doing sets of twelve gets
 * 12 -> 14. Neither is told to chase a number they have never trained at.
 */
export function deriveSchemeFor(
  ref: ExerciseRef,
  sessions: readonly CompletedSession[],
  incrementKg: number,
): ProgressionScheme {
  const base = defaultSchemeFor(ref, incrementKg);
  if (base.kind !== 'double') return base;

  const counts = new Map<number, number>();
  for (const session of progressionHistory(ref, sessions)) {
    for (const set of session.sets) {
      if (set.state !== 'completed' || set.type === 'warmup') continue;
      const reps = set.effort.kind === 'reps' || set.effort.kind === 'reps_and_duration'
        ? set.effort.reps
        : null;
      if (reps === null || reps <= 0) continue;
      counts.set(reps, (counts.get(reps) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return base;

  // Most frequent rep count; ties go to the heavier end, which is the one the lifter
  // is more likely to be working toward.
  let usual = 0;
  let best = -1;
  for (const [reps, seen] of counts) {
    if (seen > best || (seen === best && reps > usual)) {
      usual = reps;
      best = seen;
    }
  }

  return { ...base, repRange: { min: usual, max: usual + REP_RANGE_HEADROOM } };
}

/** Past outings of this exercise, in the shape the progression rules read. */
export function progressionHistory(
  ref: Pick<ExerciseRef, 'exerciseId' | 'variantId'>,
  sessions: readonly CompletedSession[],
  limit = 8,
): ExerciseSession[] {
  const key = exerciseKey(ref);
  const out: ExerciseSession[] = [];

  for (const session of byMostRecent(sessions)) {
    for (const exercise of session.exercises) {
      if (exerciseKey(exercise.exercise) !== key) continue;
      out.push({
        performedAt: session.startedAt,
        sets: exercise.sets.map(toPerformedSet),
        ...(session.bodyweightKg === undefined
          ? {}
          : { context: { bodyweightKg: session.bodyweightKg } satisfies LoadContext }),
      });
      break;
    }
    if (out.length >= limit) break;
  }

  return out.reverse();
}

/** What to do next on this exercise, in one line the lifter can read between sets. */
export function suggestionFor(
  ref: ExerciseRef,
  sessions: readonly CompletedSession[],
  incrementKg: number,
  scheme?: ProgressionScheme,
): Prescription {
  return nextPrescription(
    progressionHistory(ref, sessions),
    scheme ?? deriveSchemeFor(ref, sessions, incrementKg),
  );
}

/**
 * The lifter's bests for one exercise, folded out of the local history.
 *
 * A real implementation reads `/users/{uid}/personalRecords/{exerciseKey}` — a lookup
 * on a derived id, no query (SCHEMA.md). Until the sync team wires that collection up,
 * this folds the same numbers out of the sessions already on the device, which gives
 * the same answer for anything inside the local retention window and is honest about
 * being an approximation outside it.
 */
export function bestsFor(
  ref: Pick<ExerciseRef, 'exerciseId' | 'variantId'>,
  sessions: readonly CompletedSession[],
): CurrentBests {
  const key = exerciseKey(ref);
  let bests: CurrentBests = {};

  for (const session of sessions) {
    for (const exercise of session.exercises) {
      if (exerciseKey(exercise.exercise) !== key) continue;
      const context: LoadContext =
        session.bodyweightKg === undefined ? {} : { bodyweightKg: session.bodyweightKg };
      const { achievements } = detectRecords(candidatesOf(exercise), bests, {}, context);
      bests = achievements.reduce<CurrentBests>(
        (carried, achievement) => ({ ...carried, [achievement.type]: achievement.value }),
        bests,
      );
    }
  }

  return bests;
}

/** Which records the sets logged so far in *this* session have beaten. */
export function recordsThisSession(
  exercise: DraftExercise,
  workout: DraftWorkout,
  sessions: readonly CompletedSession[],
): readonly RecordDetection[] {
  const context: LoadContext =
    workout.bodyweightKg === undefined ? {} : { bodyweightKg: workout.bodyweightKg };
  return detectRecords(
    candidatesOf(exercise),
    bestsFor(exercise.exercise, sessions),
    {},
    context,
  ).achievements;
}

function candidatesOf(exercise: DraftExercise): CandidateSet[] {
  return exercise.sets.map((set) => ({ ...toPerformedSet(set), setId: set.id }));
}

/**
 * The suggestion as one short line. No paragraphs in the workout flow.
 *
 * `null` when there is nothing useful to say — an empty hint is better than a hint
 * that says "hold" every week, which trains the lifter to stop reading the line.
 */
export function suggestionLine(prescription: Prescription): string | null {
  if (prescription.action === 'first_session') return null;
  if (prescription.action === 'hold') return null;

  const load = prescription.loadKg === null ? null : `${trim(prescription.loadKg)}kg`;
  const effort =
    prescription.durationSec !== null
      ? `${prescription.durationSec}s`
      : prescription.reps !== null
        ? `x${prescription.reps}`
        : null;

  const target = [load, effort].filter((part) => part !== null).join(' ');
  return target === '' ? prescription.reason : `Next: ${target} — ${prescription.reason}`;
}

function trim(kg: number): string {
  const rounded = Math.round(kg * 100) / 100;
  return String(rounded);
}
