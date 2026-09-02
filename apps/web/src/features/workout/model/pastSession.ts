import type { ExerciseRef, SetId, SetState, WorkoutExerciseId, WorkoutId } from '@freeforever/data';

import type { CompletedSession } from './history.js';
import { type SetPatch, workoutReducer } from './session.js';
import type { DraftWorkout } from './types.js';

/**
 * Editing a session that is already finished.
 *
 * The project owner's first report opened with "I am unable to edit training sessions or
 * even view them historically". This module is the write half of the answer.
 *
 * ## It reuses the live reducer rather than reimplementing it
 *
 * Every operation here routes through `workoutReducer`. That is not laziness about
 * duplication — it is about **ordering**. Sets are ordered by a fractional index, never
 * an array position (`common/sortKey.ts`), and the arithmetic that derives a key from
 * two neighbours lives inside `session.ts` as private helpers. A second implementation
 * of "insert a set here" would either re-export those internals or quietly get the keys
 * wrong, and wrong keys are the failure mode that ADR-0025 says loses somebody's log.
 *
 * So a `CompletedSession` is lifted into the shape the reducer already knows, reduced,
 * and lowered back. The round trip is lossless: `asDraft` invents exactly the three
 * fields a finished session does not carry, and `asSession` drops exactly those three.
 *
 * ## Undo is a whole-session snapshot, not the reducer's undo stack
 *
 * The reducer keeps an undo stack for removals, which is right for a live session where
 * the only destructive act is a removal. Here *any* edit is worth undoing — a corrected
 * weight as much as a deleted set — so the screen keeps the session as it was before the
 * edit and puts it straight back. A session is a few kilobytes; holding one for the life
 * of a toast costs nothing and makes undo correct for every operation rather than one.
 *
 * ## Every edit stamps `editedAt`
 *
 * Because personal records are derived from history, an edit rewrites all-time numbers.
 * See the field's comment on {@link CompletedSession} for why that has to be visible.
 */

/** The three fields a finished session does not carry, invented for the round trip. */
const SYNTHETIC_TITLE = 'Session';

/**
 * A finished session in the shape the reducer understands.
 *
 * `status: 'in_progress'` is deliberate and is the one part worth reading twice: several
 * reducer cases are guarded on a workout being live, and lifting a finished session as
 * `'completed'` would make them no-ops. Nothing persists from this value — `asSession`
 * drops it, and the draft never reaches storage.
 */
function asDraft(session: CompletedSession): DraftWorkout {
  return {
    id: session.id as WorkoutId,
    status: 'in_progress',
    title: SYNTHETIC_TITLE,
    startedAt: session.startedAt,
    localDate: session.localDate,
    tzOffsetMinutes: 0,
    exercises: session.exercises,
    ...(session.endedAt === undefined ? {} : { endedAt: session.endedAt }),
    ...(session.bodyweightKg === undefined ? {} : { bodyweightKg: session.bodyweightKg }),
  };
}

/**
 * Back to a session, keeping every field the original had and stamping the edit.
 *
 * Rebuilt from `original` rather than from the draft, so the three synthetic fields
 * cannot leak into storage even if the reducer starts carrying more of them.
 */
function asSession(
  original: CompletedSession,
  workout: DraftWorkout,
  now: number,
): CompletedSession {
  return {
    id: original.id,
    localDate: original.localDate,
    startedAt: original.startedAt,
    exercises: workout.exercises,
    editedAt: now,
    ...(original.endedAt === undefined ? {} : { endedAt: original.endedAt }),
    ...(original.bodyweightKg === undefined ? {} : { bodyweightKg: original.bodyweightKg }),
    ...(original.status === undefined ? {} : { status: original.status }),
  };
}

/** What the history screen can do to a set that has already been logged. */
export type PastSessionEdit =
  | { readonly kind: 'value'; readonly patch: SetPatch }
  | { readonly kind: 'state'; readonly state: SetState }
  | { readonly kind: 'remove' }
  | { readonly kind: 'add_after' };

export interface PastSessionTarget {
  readonly exerciseId: WorkoutExerciseId;
  readonly setId: SetId;
}

/**
 * Apply one edit to a finished session.
 *
 * Returns the same object when nothing changed, so a no-op cannot stamp `editedAt` and
 * make an untouched session claim it was edited — the caption is only worth showing if
 * it is true.
 */
export function editPastSession(
  session: CompletedSession,
  target: PastSessionTarget,
  edit: PastSessionEdit,
  now: number,
): CompletedSession {
  const before = { workout: asDraft(session), undoStack: [] };
  const after = workoutReducer(before, actionFor(target, edit, now));
  // Identity, not deep equality: the reducer already returns the same state object for
  // an edit that hit nothing, which is the cheapest possible "did anything happen".
  if (after.workout === before.workout) return session;
  return asSession(session, after.workout, now);
}

function actionFor(
  target: PastSessionTarget,
  edit: PastSessionEdit,
  now: number,
): Parameters<typeof workoutReducer>[1] {
  switch (edit.kind) {
    case 'value':
      return {
        type: 'edit_set',
        exerciseId: target.exerciseId,
        setId: target.setId,
        patch: edit.patch,
      };
    case 'state':
      /*
       * No `commit`. On the live screen the state tap resolves a ghost into real data,
       * because the row may still be showing last session's numbers. A finished session
       * has no ghosts — every number in it is either entered or genuinely absent — so
       * committing here would invent data that was never logged.
       */
      return {
        type: 'set_set_state',
        exerciseId: target.exerciseId,
        setId: target.setId,
        state: edit.state,
        now,
      };
    case 'remove':
      return { type: 'remove_set', exerciseId: target.exerciseId, setId: target.setId };
    case 'add_after':
      // A set the lifter forgot, in the place it belongs: directly after the one they
      // are looking at, not appended to the end of the exercise.
      return {
        type: 'add_set',
        exerciseId: target.exerciseId,
        after: target.setId,
        now,
      };
  }
}

/**
 * Add a whole exercise to a finished session.
 *
 * Not a `PastSessionEdit`: every member of that union names a set it acts on, and this
 * one has no target — there is no set yet. Folding it in would mean an optional
 * `setId` on `PastSessionTarget`, which would make the field optional for the four
 * edits that genuinely require it. A separate entry point keeps that type honest.
 *
 * **One empty set, not the live screen's three.** Three empty rows on a live session are
 * a plan for what you are about to do. On a session that finished three weeks ago there
 * is nothing to plan — you are recording one thing you forgot to log — and two extra
 * blank rows in history are noise you then have to delete. `add_after` already covers
 * the second and third set.
 *
 * The set arrives `pending` with no numbers. A finished session has no ghosts to inherit
 * from, and inventing numbers into history is the one thing this module must never do.
 * Pending sets in a completed session are already a normal state: `sessionVolume` skips
 * them, and `isEmptyNow` does not count them as work, so an exercise added and never
 * filled in still leaves the session retractable.
 */
export function addExerciseToPastSession(
  session: CompletedSession,
  exercise: ExerciseRef,
  now: number,
): CompletedSession {
  const before = { workout: asDraft(session), undoStack: [] };
  const after = workoutReducer(before, { type: 'add_exercise', exercise, sets: 1, now });
  // The reducer refuses past its own ceilings (`canAddExercise`) by returning the state
  // it was given. Same identity check as `editPastSession`: no change, no `editedAt`.
  if (after.workout === before.workout) return session;
  return asSession(session, after.workout, now);
}

/** Has this session been changed since it was logged? */
export function wasEdited(session: CompletedSession): boolean {
  return session.editedAt !== undefined;
}

/**
 * Is there anything left in this session worth keeping?
 *
 * A session whose last logged set is deleted is no longer a workout, and leaving an
 * empty one in history puts a phantom session into the streak and the session count
 * insights reads — the same rule `hasLoggedWork` enforces at the other end of the
 * session's life. The screen offers to retract it rather than doing so silently.
 */
export function isEmptyNow(session: CompletedSession): boolean {
  return !session.exercises.some((exercise) =>
    exercise.sets.some((set) => set.state !== 'pending'),
  );
}
