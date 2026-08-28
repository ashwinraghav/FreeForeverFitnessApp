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

/**
 * The default scheme for an exercise the lifter has not configured.
 *
 * Double progression on a rep range, because it is the scheme that fails most safely:
 * it adds a rep before it adds weight, so a bad day costs one rep rather than a missed
 * set, and it works for accessories and main lifts alike. A programme that prescribes
 * something else overrides this; the point of a default is that the app has an opinion
 * on session one rather than waiting to be configured.
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
  return { kind: 'double', repRange: { min: 8, max: 12 }, incrementKg };
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
  scheme: ProgressionScheme = defaultSchemeFor(ref, incrementKg),
): Prescription {
  return nextPrescription(progressionHistory(ref, sessions), scheme);
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
