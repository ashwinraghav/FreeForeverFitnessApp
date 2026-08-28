import { MAX_EXERCISES_PER_WORKOUT, MAX_SETS_PER_EXERCISE } from '@freeforever/data';
import { describe, expect, it } from 'vitest';

import { STARTER_CATALOGUE } from '../catalogue/starter.js';
import { toExerciseRef } from '../catalogue/types.js';
import {
  canAddExercise,
  canAddSet,
  nextSetState,
  orderedExercises,
  orderedSets,
  startWorkout,
  totalSetCount,
  workoutReducer,
  type WorkoutAction,
} from './session.js';
import type { WorkoutState } from './types.js';

const bench = toExerciseRef(STARTER_CATALOGUE.find((e) => e.id === 'bench-press')!);
const squat = toExerciseRef(STARTER_CATALOGUE.find((e) => e.id === 'back-squat')!);
const plank = toExerciseRef(STARTER_CATALOGUE.find((e) => e.id === 'plank')!);

const NOW = 1_760_000_000_000;

function run(state: WorkoutState, ...actions: readonly WorkoutAction[]): WorkoutState {
  return actions.reduce(workoutReducer, state);
}

function withBench(sets = 3): WorkoutState {
  return run(startWorkout({ now: NOW }), { type: 'add_exercise', exercise: bench, sets, now: NOW });
}

function firstExercise(state: WorkoutState) {
  const exercise = orderedExercises(state.workout)[0];
  if (exercise === undefined) throw new Error('expected an exercise');
  return exercise;
}

describe('starting a session', () => {
  it('is empty, in progress, and dated in the local timezone', () => {
    const state = startWorkout({ now: NOW, date: new Date(2026, 7, 28, 18, 30) });
    expect(state.workout.status).toBe('in_progress');
    expect(state.workout.exercises).toEqual([]);
    expect(state.workout.localDate).toBe('2026-08-28');
    expect(state.workout.title).toBe('Evening session');
  });

  it('does not fabricate a bodyweight', () => {
    expect(startWorkout({ now: NOW }).workout.bodyweightKg).toBeUndefined();
  });
});

describe('adding exercises and sets', () => {
  it('lays out empty sets, not zeroed ones', () => {
    const state = withBench(3);
    const sets = orderedSets(firstExercise(state));
    expect(sets).toHaveLength(3);
    for (const set of sets) {
      // `null` is not zero. An empty set and a set of zero reps are different facts.
      expect(set.weightKg).toBeNull();
      expect(set.reps).toBeNull();
      expect(set.state).toBe('pending');
      expect(set.performedAt).toBeUndefined();
    }
  });

  it('copies the load and effort kinds off the exercise', () => {
    const state = run(startWorkout({ now: NOW }), {
      type: 'add_exercise',
      exercise: plank,
      sets: 1,
      now: NOW,
    });
    const set = orderedSets(firstExercise(state))[0];
    expect(set?.loadKind).toBe('none');
    expect(set?.effortKind).toBe('duration');
  });

  it('gives every set a distinct, sorted key', () => {
    const keys = orderedSets(firstExercise(withBench(5))).map((set) => set.sortKey);
    expect(new Set(keys).size).toBe(5);
    expect(keys).toEqual([...keys].sort());
  });

  it('appends an exercise at the end by default', () => {
    const state = run(withBench(), { type: 'add_exercise', exercise: squat, now: NOW });
    expect(orderedExercises(state.workout).map((e) => e.exercise.name)).toEqual([
      'Bench Press',
      'Back Squat',
    ]);
  });

  it('inserts an exercise where asked', () => {
    const state = run(withBench(), { type: 'add_exercise', exercise: squat, at: 0, now: NOW });
    expect(orderedExercises(state.workout)[0]?.exercise.name).toBe('Back Squat');
  });

  it('a new set inherits the type of the one it follows', () => {
    const state = run(
      startWorkout({ now: NOW }),
      { type: 'add_exercise', exercise: bench, sets: 1, setType: 'warmup', now: NOW },
    );
    const exerciseId = firstExercise(state).id;
    const next = run(state, { type: 'add_set', exerciseId, now: NOW });
    // "Add another" after a warmup gives another warmup, not a silent start to the
    // working sets.
    expect(orderedSets(firstExercise(next))[1]?.type).toBe('warmup');
  });

  it('inserts a set directly after the one named', () => {
    const state = withBench(3);
    const exercise = firstExercise(state);
    const second = orderedSets(exercise)[1];
    const next = run(state, { type: 'add_set', exerciseId: exercise.id, after: second?.id, now: NOW });
    const ids = orderedSets(firstExercise(next)).map((set) => set.id);
    expect(ids).toHaveLength(4);
    expect(ids[1]).toBe(second?.id);
    expect(ids[2]).not.toBe(orderedSets(exercise)[2]?.id);
  });
});

describe('the caps that firestore.rules also enforces', () => {
  it('refuses a 41st exercise rather than building an unwritable document', () => {
    let state = startWorkout({ now: NOW });
    for (let i = 0; i < MAX_EXERCISES_PER_WORKOUT; i += 1) {
      state = run(state, { type: 'add_exercise', exercise: bench, sets: 0, now: NOW });
    }
    expect(canAddExercise(state.workout)).toBe(false);
    const after = run(state, { type: 'add_exercise', exercise: squat, now: NOW });
    expect(after.workout.exercises).toHaveLength(MAX_EXERCISES_PER_WORKOUT);
    expect(after).toBe(state);
  });

  it('refuses a 51st set on one exercise', () => {
    let state = run(startWorkout({ now: NOW }), {
      type: 'add_exercise',
      exercise: bench,
      sets: MAX_SETS_PER_EXERCISE,
      now: NOW,
    });
    const exerciseId = firstExercise(state).id;
    expect(canAddSet(state.workout, exerciseId)).toBe(false);
    state = run(state, { type: 'add_set', exerciseId, now: NOW });
    expect(firstExercise(state).sets).toHaveLength(MAX_SETS_PER_EXERCISE);
  });

  it('clamps the initial set count to the per-exercise cap', () => {
    const state = run(startWorkout({ now: NOW }), {
      type: 'add_exercise',
      exercise: bench,
      sets: 500,
      now: NOW,
    });
    expect(totalSetCount(state.workout)).toBe(MAX_SETS_PER_EXERCISE);
  });
});

describe('logging a set', () => {
  it('marks it completed and stamps when', () => {
    const state = withBench();
    const exercise = firstExercise(state);
    const set = orderedSets(exercise)[0];
    const next = run(state, {
      type: 'set_set_state',
      exerciseId: exercise.id,
      setId: set!.id,
      state: 'completed',
      commit: { weightKg: 100, reps: 5 },
      now: NOW,
    });
    const logged = orderedSets(firstExercise(next))[0];
    expect(logged?.state).toBe('completed');
    expect(logged?.performedAt).toBe(NOW);
    expect(logged?.weightKg).toBe(100);
    expect(logged?.reps).toBe(5);
  });

  it('commits the ghost only into fields the lifter left empty', () => {
    const state = withBench();
    const exercise = firstExercise(state);
    const setId = orderedSets(exercise)[0]!.id;
    const typed = run(state, {
      type: 'edit_set',
      exerciseId: exercise.id,
      setId,
      patch: { weightKg: 102.5 },
    });
    const logged = run(typed, {
      type: 'set_set_state',
      exerciseId: exercise.id,
      setId,
      state: 'completed',
      commit: { weightKg: 100, reps: 5 },
      now: NOW,
    });
    const set = orderedSets(firstExercise(logged))[0];
    // A typed value always wins over a carried-over one.
    expect(set?.weightKg).toBe(102.5);
    expect(set?.reps).toBe(5);
  });

  it('records the rest actually taken', () => {
    const state = withBench();
    const exercise = firstExercise(state);
    const next = run(state, {
      type: 'set_set_state',
      exerciseId: exercise.id,
      setId: orderedSets(exercise)[0]!.id,
      state: 'completed',
      restSecBefore: 93.4,
      now: NOW,
    });
    expect(orderedSets(firstExercise(next))[0]?.restSecBefore).toBe(93);
  });

  it('walks pending, completed, failed, pending', () => {
    expect(nextSetState('pending')).toBe('completed');
    expect(nextSetState('completed')).toBe('failed');
    expect(nextSetState('failed')).toBe('pending');
  });

  it('going back to pending keeps the numbers and forgets only the attempt', () => {
    const state = withBench();
    const exercise = firstExercise(state);
    const setId = orderedSets(exercise)[0]!.id;
    const logged = run(state, {
      type: 'set_set_state',
      exerciseId: exercise.id,
      setId,
      state: 'completed',
      commit: { weightKg: 100, reps: 5 },
      restSecBefore: 90,
      now: NOW,
    });
    const undone = run(logged, {
      type: 'set_set_state',
      exerciseId: exercise.id,
      setId,
      state: 'pending',
      now: NOW,
    });
    const set = orderedSets(firstExercise(undone))[0];
    expect(set?.state).toBe('pending');
    expect(set?.weightKg).toBe(100);
    expect(set?.reps).toBe(5);
    // `performedAt` must be set if and only if the set has been attempted.
    expect(set?.performedAt).toBeUndefined();
    expect(set?.restSecBefore).toBeUndefined();
    expect('performedAt' in (set as object)).toBe(false);
  });

  it('a failed set keeps the reps that were actually made', () => {
    const state = withBench();
    const exercise = firstExercise(state);
    const setId = orderedSets(exercise)[0]!.id;
    const next = run(
      state,
      { type: 'edit_set', exerciseId: exercise.id, setId, patch: { weightKg: 100, reps: 3 } },
      { type: 'set_set_state', exerciseId: exercise.id, setId, state: 'failed', now: NOW },
    );
    const set = orderedSets(firstExercise(next))[0];
    expect(set?.state).toBe('failed');
    expect(set?.reps).toBe(3);
    expect(set?.performedAt).toBe(NOW);
  });
});

describe('editing never loses a neighbour', () => {
  it('editing one set leaves the others alone', () => {
    const state = withBench(3);
    const exercise = firstExercise(state);
    const sets = orderedSets(exercise);
    const filled = run(
      state,
      { type: 'edit_set', exerciseId: exercise.id, setId: sets[0]!.id, patch: { weightKg: 100, reps: 5 } },
      { type: 'edit_set', exerciseId: exercise.id, setId: sets[1]!.id, patch: { weightKg: 105, reps: 3 } },
    );
    const after = orderedSets(firstExercise(filled));
    expect(after[0]?.weightKg).toBe(100);
    expect(after[1]?.weightKg).toBe(105);
    expect(after[2]?.weightKg).toBeNull();
  });

  it('clears a field with undefined rather than storing an undefined', () => {
    const state = withBench(1);
    const exercise = firstExercise(state);
    const setId = orderedSets(exercise)[0]!.id;
    const withNote = run(state, {
      type: 'edit_set',
      exerciseId: exercise.id,
      setId,
      patch: { note: 'felt heavy' },
    });
    expect(orderedSets(firstExercise(withNote))[0]?.note).toBe('felt heavy');
    const cleared = run(withNote, {
      type: 'edit_set',
      exerciseId: exercise.id,
      setId,
      patch: { note: undefined },
    });
    expect('note' in (orderedSets(firstExercise(cleared))[0] as object)).toBe(false);
  });
});

describe('reordering never loses entered data', () => {
  it('moving a set keeps every value in the exercise', () => {
    const state = withBench(3);
    const exercise = firstExercise(state);
    const sets = orderedSets(exercise);
    const filled = run(
      state,
      ...sets.map((set, index) => ({
        type: 'edit_set' as const,
        exerciseId: exercise.id,
        setId: set.id,
        patch: { weightKg: 100 + index * 5, reps: 5 - index },
      })),
    );

    const moved = run(filled, {
      type: 'move_set',
      exerciseId: exercise.id,
      setId: sets[2]!.id,
      toIndex: 0,
    });

    const after = orderedSets(firstExercise(moved));
    expect(after.map((set) => set.weightKg)).toEqual([110, 100, 105]);
    expect(after.map((set) => set.reps)).toEqual([3, 5, 4]);
  });

  it('a move changes exactly one sort key', () => {
    // The point of a fractional index: inserting or moving touches one field on one
    // set, so two devices editing the same session merge instead of overwriting.
    const state = withBench(4);
    const exercise = firstExercise(state);
    const before = new Map(orderedSets(exercise).map((set) => [set.id, set.sortKey]));
    const moved = run(state, {
      type: 'move_set',
      exerciseId: exercise.id,
      setId: orderedSets(exercise)[3]!.id,
      toIndex: 1,
    });
    const changed = orderedSets(firstExercise(moved)).filter(
      (set) => before.get(set.id) !== set.sortKey,
    );
    expect(changed).toHaveLength(1);
  });

  it('moving an exercise keeps its sets', () => {
    const state = run(withBench(2), { type: 'add_exercise', exercise: squat, sets: 2, now: NOW });
    const moved = run(state, {
      type: 'move_exercise',
      exerciseId: orderedExercises(state.workout)[1]!.id,
      toIndex: 0,
    });
    const ordered = orderedExercises(moved.workout);
    expect(ordered.map((e) => e.exercise.name)).toEqual(['Back Squat', 'Bench Press']);
    expect(ordered.every((e) => e.sets.length === 2)).toBe(true);
  });

  it('clamps an out-of-range destination instead of throwing', () => {
    const state = withBench(3);
    const exercise = firstExercise(state);
    const moved = run(state, {
      type: 'move_set',
      exerciseId: exercise.id,
      setId: orderedSets(exercise)[0]!.id,
      toIndex: 99,
    });
    expect(orderedSets(firstExercise(moved))).toHaveLength(3);
  });

  it('moving to where it already is is a no-op in order', () => {
    const state = withBench(3);
    const exercise = firstExercise(state);
    const ids = orderedSets(exercise).map((set) => set.id);
    const moved = run(state, { type: 'move_set', exerciseId: exercise.id, setId: ids[1]!, toIndex: 1 });
    expect(orderedSets(firstExercise(moved)).map((set) => set.id)).toEqual(ids);
  });
});

describe('removal is undoable, because there are no modals here', () => {
  it('puts a removed set back with its values intact', () => {
    const state = withBench(3);
    const exercise = firstExercise(state);
    const setId = orderedSets(exercise)[1]!.id;
    const filled = run(state, {
      type: 'edit_set',
      exerciseId: exercise.id,
      setId,
      patch: { weightKg: 105, reps: 3 },
    });

    const removed = run(filled, { type: 'remove_set', exerciseId: exercise.id, setId });
    expect(orderedSets(firstExercise(removed))).toHaveLength(2);
    expect(removed.undoStack[0]?.kind).toBe('set');

    const restored = run(removed, { type: 'undo_removal' });
    const back = orderedSets(firstExercise(restored));
    expect(back).toHaveLength(3);
    expect(back[1]?.weightKg).toBe(105);
    expect(back[1]?.reps).toBe(3);
    expect(restored.undoStack).toHaveLength(0);
  });

  it('puts a removed exercise back in its original position', () => {
    const state = run(withBench(2), { type: 'add_exercise', exercise: squat, sets: 2, now: NOW });
    const benchId = orderedExercises(state.workout)[0]!.id;
    const removed = run(state, { type: 'remove_exercise', exerciseId: benchId });
    expect(removed.workout.exercises).toHaveLength(1);

    const restored = run(removed, { type: 'undo_removal' });
    expect(orderedExercises(restored.workout).map((e) => e.exercise.name)).toEqual([
      'Bench Press',
      'Back Squat',
    ]);
  });

  it('bounds the undo stack', () => {
    let state = withBench(0);
    for (let i = 0; i < 20; i += 1) {
      state = run(state, { type: 'add_exercise', exercise: squat, sets: 0, now: NOW });
    }
    for (const exercise of orderedExercises(state.workout)) {
      state = run(state, { type: 'remove_exercise', exerciseId: exercise.id });
    }
    expect(state.undoStack.length).toBeLessThanOrEqual(10);
  });

  it('undo on an empty stack does nothing', () => {
    const state = withBench();
    expect(run(state, { type: 'undo_removal' })).toBe(state);
  });
});

describe('finishing', () => {
  it('stamps the end and closes the session', () => {
    const state = run(withBench(), { type: 'finish', now: NOW + 3_600_000 });
    expect(state.workout.status).toBe('completed');
    expect(state.workout.endedAt).toBe(NOW + 3_600_000);
  });

  it('never lets endedAt precede startedAt, however wrong the device clock is', () => {
    // `endedAt must not precede startedAt` is a schema refinement; a clock that went
    // backwards mid-session must not produce a document the write boundary rejects.
    const state = run(withBench(), { type: 'finish', now: NOW - 60_000 });
    expect(state.workout.endedAt).toBe(state.workout.startedAt);
  });

  it('discarding is a status, not a delete', () => {
    const state = run(withBench(), { type: 'discard', now: NOW });
    expect(state.workout.status).toBe('discarded');
    expect(state.workout.exercises).toHaveLength(1);
  });
});

describe('unknown targets are ignored, not thrown on', () => {
  it('editing a set that is not there returns the same state', () => {
    const state = withBench();
    const same = run(state, {
      type: 'edit_set',
      exerciseId: firstExercise(state).id,
      setId: 'nope' as never,
      patch: { reps: 5 },
    });
    expect(same).toBe(state);
  });

  it('removing an exercise that is not there returns the same state', () => {
    const state = withBench();
    expect(run(state, { type: 'remove_exercise', exerciseId: 'nope' as never })).toBe(state);
  });
});
