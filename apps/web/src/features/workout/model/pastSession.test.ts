import type { SetId, WorkoutExerciseId } from '@freeforever/data';
import { describe, expect, it } from 'vitest';

import { STARTER_CATALOGUE } from '../catalogue/starter.js';
import { toExerciseRef } from '../catalogue/types.js';
import { toCompletedSession, type CompletedSession } from './history.js';
import { addExerciseToPastSession, editPastSession, isEmptyNow, wasEdited } from './pastSession.js';
import { orderedSets, startWorkout, workoutReducer } from './session.js';

const bench = toExerciseRef(STARTER_CATALOGUE.find((entry) => entry.id === 'bench-press')!);
const squat = toExerciseRef(STARTER_CATALOGUE.find((entry) => entry.id === 'back-squat')!);
const NOW = 1_760_000_000_000;
const LATER = NOW + 86_400_000;

/** A finished session: three sets, the first two logged at 100x5, the third untouched. */
function finished(): CompletedSession {
  const started = workoutReducer(startWorkout({ now: NOW }), {
    type: 'add_exercise',
    exercise: bench,
    sets: 3,
    now: NOW,
  });
  const exercise = started.workout.exercises[0]!;
  const logged = orderedSets(exercise)
    .slice(0, 2)
    .reduce(
      (state, set) =>
        workoutReducer(state, {
          type: 'set_set_state',
          exerciseId: exercise.id,
          setId: set.id,
          state: 'completed',
          commit: { weightKg: 100, reps: 5 },
          now: NOW,
        }),
      started,
    );
  return toCompletedSession(workoutReducer(logged, { type: 'finish', now: NOW + 3600_000 }).workout);
}

function firstExercise(session: CompletedSession) {
  return session.exercises[0]!;
}

function target(session: CompletedSession, index = 0) {
  const exercise = firstExercise(session);
  return {
    exerciseId: exercise.id as WorkoutExerciseId,
    setId: orderedSets(exercise)[index]!.id as SetId,
  };
}

describe('correcting a session that is already finished', () => {
  it('corrects a mistyped weight and keeps everything else', () => {
    // The commonest edit by a distance: 102.5 typed as 100. Nothing else may move.
    const before = finished();
    const after = editPastSession(before, target(before), {
      kind: 'value',
      patch: { weightKg: 102.5 },
    }, LATER);

    const sets = orderedSets(firstExercise(after));
    expect(sets[0]?.weightKg).toBe(102.5);
    expect(sets[0]?.reps).toBe(5);
    expect(sets[0]?.state).toBe('completed');
    expect(sets[1]?.weightKg).toBe(100);
    expect(after.startedAt).toBe(before.startedAt);
    expect(after.endedAt).toBe(before.endedAt);
  });

  it('changes an outcome without inventing numbers that were never logged', () => {
    /*
     * The live screen's state tap carries a `commit`, because the row may still be
     * showing last session's ghost. A finished session has no ghosts, so committing here
     * would write data the lifter never entered. The untouched third set proves it: it
     * has no numbers, and marking it missed must not give it any.
     */
    const before = finished();
    const after = editPastSession(before, target(before, 2), {
      kind: 'state',
      state: 'failed',
    }, LATER);

    const third = orderedSets(firstExercise(after))[2];
    expect(third?.state).toBe('failed');
    expect(third?.weightKg).toBeNull();
    expect(third?.reps).toBeNull();
  });

  it('removes one set and leaves the rest in order', () => {
    const before = finished();
    const after = editPastSession(before, target(before, 1), { kind: 'remove' }, LATER);

    const sets = orderedSets(firstExercise(after));
    expect(sets).toHaveLength(2);
    expect(sets.map((set) => set.weightKg)).toEqual([100, null]);
  });

  it('adds a forgotten set directly after the one being looked at, not at the end', () => {
    // "I did a fourth set" almost always means "here", and a set appended past the
    // untouched rows would need reordering by hand to be right.
    const before = finished();
    const after = editPastSession(before, target(before, 0), { kind: 'add_after' }, LATER);

    const sets = orderedSets(firstExercise(after));
    expect(sets).toHaveLength(4);
    expect(sets[1]?.state).toBe('pending');
    expect(sets[1]?.weightKg).toBeNull();
    // Ordering comes from the fractional index, which is why this routes through the
    // live reducer rather than a second implementation.
    expect(sets.map((set) => set.sortKey)).toEqual([...sets].sort().map((set) => set.sortKey));
  });

  it('stamps editedAt, because personal records are derived from this', () => {
    const before = finished();
    expect(wasEdited(before)).toBe(false);

    const after = editPastSession(before, target(before), {
      kind: 'value',
      patch: { reps: 6 },
    }, LATER);
    expect(after.editedAt).toBe(LATER);
    expect(wasEdited(after)).toBe(true);
  });

  it('does not claim an edit when nothing was edited', () => {
    // Identity, so a mis-aimed edit cannot put an "edited" caption on an untouched
    // session — the caption is only worth showing if it is true.
    const before = finished();
    const after = editPastSession(
      before,
      { exerciseId: 'nope' as WorkoutExerciseId, setId: 'nope' as SetId },
      { kind: 'value', patch: { reps: 6 } },
      LATER,
    );
    expect(after).toBe(before);
    expect(wasEdited(after)).toBe(false);
  });

  it('never lets the reducer round-trip leak its synthetic fields into storage', () => {
    /*
     * `asDraft` invents a title, a timezone offset and `status: 'in_progress'` so the
     * live reducer will act on the session at all. None of the three may come back out:
     * a stored session carrying `status: 'in_progress'` would be read as active, and
     * `loadActive` would try to resume a workout from three weeks ago.
     */
    const before = finished();
    const after = editPastSession(before, target(before), {
      kind: 'value',
      patch: { reps: 6 },
    }, LATER);

    expect(Object.keys(after).sort()).toEqual(
      ['editedAt', 'endedAt', 'exercises', 'id', 'localDate', 'startedAt'].sort(),
    );
    expect('status' in after).toBe(false);
    expect('title' in after).toBe(false);
    expect('tzOffsetMinutes' in after).toBe(false);
  });

  it('preserves a retraction across an edit rather than quietly reviving it', () => {
    const retracted: CompletedSession = { ...finished(), status: 'discarded' };
    const after = editPastSession(retracted, target(retracted), {
      kind: 'value',
      patch: { reps: 6 },
    }, LATER);
    expect(after.status).toBe('discarded');
  });
});

describe('a session with nothing logged left in it', () => {
  it('is recognised, so history does not keep a phantom session', () => {
    // The same rule `hasLoggedWork` enforces at the other end of a session's life: an
    // empty session in history is a phantom in the streak and in the session count
    // insights reads off it.
    let session = finished();
    expect(isEmptyNow(session)).toBe(false);

    for (const index of [1, 0]) {
      session = editPastSession(session, target(session, index), { kind: 'remove' }, LATER);
    }
    expect(isEmptyNow(session)).toBe(true);
  });

  it('counts an unlogged set as nothing, not as something', () => {
    // One untouched row is left after the two logged ones go. A pending set is not work.
    let session = finished();
    for (const index of [1, 0]) {
      session = editPastSession(session, target(session, index), { kind: 'remove' }, LATER);
    }
    expect(orderedSets(firstExercise(session))).toHaveLength(1);
    expect(isEmptyNow(session)).toBe(true);
  });
});

describe('adding an exercise you forgot to log', () => {
  it('appends it to the session and stamps the edit', () => {
    const before = finished();
    const after = addExerciseToPastSession(before, squat, LATER);

    expect(after).not.toBe(before);
    expect(after.exercises).toHaveLength(2);
    // Appended, not prepended: the order a session is read in is the order it happened.
    expect(after.exercises[1]!.exercise.exerciseId).toBe(squat.exerciseId);
    expect(wasEdited(after)).toBe(true);
    expect(after.editedAt).toBe(LATER);
  });

  it('leaves everything already logged untouched', () => {
    const before = finished();
    const after = addExerciseToPastSession(before, squat, LATER);

    expect(after.id).toBe(before.id);
    expect(after.localDate).toBe(before.localDate);
    expect(after.startedAt).toBe(before.startedAt);
    expect(after.endedAt).toBe(before.endedAt);
    expect(after.exercises[0]).toEqual(before.exercises[0]);
  });

  it('arrives as one empty pending set, inventing no numbers', () => {
    const after = addExerciseToPastSession(finished(), squat, LATER);
    const added = after.exercises[1]!;

    // One, not the live screen's three: nothing is being planned here.
    expect(added.sets).toHaveLength(1);
    const set = added.sets[0]!;
    expect(set.state).toBe('pending');
    // `null`, the codebase's "no number was entered" — not a zero, which would be a
    // number somebody could believe.
    expect(set.weightKg).toBeNull();
    expect(set.reps).toBeNull();
  });

  it('does not make an emptied session look like it has work in it again', () => {
    // Strip the session back to nothing, the state that offers to retract it.
    let session = finished();
    for (const set of orderedSets(firstExercise(session))) {
      session = editPastSession(
        session,
        { exerciseId: firstExercise(session).id as WorkoutExerciseId, setId: set.id as SetId },
        { kind: 'remove' },
        LATER,
      );
    }
    expect(isEmptyNow(session)).toBe(true);

    const after = addExerciseToPastSession(session, squat, LATER);
    // The added set is pending, and pending is not logged work — so the retract offer
    // must survive. Otherwise adding an exercise would silently resurrect a phantom
    // session into the streak and the session count insights reads.
    expect(after.exercises).toHaveLength(2);
    expect(isEmptyNow(after)).toBe(true);
  });

  it('can be added twice, as two separate exercises', () => {
    const once = addExerciseToPastSession(finished(), squat, LATER);
    const twice = addExerciseToPastSession(once, squat, LATER);

    expect(twice.exercises).toHaveLength(3);
    // Distinct rows, not a merge: two entries of the same lift in one session is a
    // normal thing to have done.
    expect(twice.exercises[1]!.id).not.toBe(twice.exercises[2]!.id);
  });
});
