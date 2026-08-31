import {
  MAX_EXERCISES_PER_WORKOUT,
  MAX_SETS_PER_EXERCISE,
  MAX_SETS_PER_WORKOUT,
  sortKeyBetween,
  sortedByKey,
  type EpochMillis,
  type ExerciseRef,
  type SetId,
  type SetState,
  type SetType,
  type SortKey,
  type WorkoutExerciseId,
} from '@freeforever/data';

import { localDateOf, newSetId, newWorkoutExerciseId, newWorkoutId, tzOffsetMinutesOf } from './ids.js';
import type { DraftExercise, DraftSet, DraftWorkout, Removal, WorkoutState } from './types.js';

/**
 * The session reducer.
 *
 * One rule governs every case in it: **an edit never destroys a number the user
 * typed.** Reordering a set keeps its values. Adding an exercise in the middle keeps
 * every other exercise's values. Marking a set back to pending keeps the weight and
 * the reps — it only forgets that the set was attempted. Removing something is the
 * single exception, and it pushes what it removed onto an undo stack rather than
 * dropping it, because there are no modals in this flow to ask "are you sure?"
 * (CLAUDE.md) and losing entered sets is the worst failure mode in the category.
 *
 * The second rule is that ordering is a fractional index, never an array position.
 * `sortKey` is derived from a set's two neighbours, so inserting between two sets
 * touches one field on one set and two devices inserting into the same gap merge as a
 * union instead of one overwriting the other (see `common/sortKey.ts`). The arrays
 * here are kept sorted for convenience; the keys are what is authoritative.
 */

/** Removals kept for undo. Deep enough to cover a fumble, shallow enough to bound memory. */
export const MAX_UNDO = 10;

export interface StartWorkoutOptions {
  readonly title?: string;
  readonly now?: number;
  readonly bodyweightKg?: number;
  readonly date?: Date;
}

export function startWorkout(options: StartWorkoutOptions = {}): WorkoutState {
  const now = options.now ?? Date.now();
  const date = options.date ?? new Date(now);
  return {
    workout: {
      id: newWorkoutId(now),
      status: 'in_progress',
      title: options.title ?? defaultTitle(date),
      startedAt: now,
      localDate: localDateOf(date),
      tzOffsetMinutes: tzOffsetMinutesOf(date),
      exercises: [],
      ...(options.bodyweightKg === undefined ? {} : { bodyweightKg: options.bodyweightKg }),
    },
    undoStack: [],
  };
}

/** Values the UI hands in when logging a set that is still showing its ghost. */
export interface CommitValues {
  readonly weightKg?: number | null;
  readonly reps?: number | null;
  readonly durationSec?: number | null;
  readonly distanceM?: number | null;
}

export type EditableSetFields = Pick<
  DraftSet,
  'weightKg' | 'reps' | 'durationSec' | 'distanceM' | 'type' | 'effortRating' | 'note' | 'tags'
>;

/**
 * A patch over the editable fields.
 *
 * `undefined` is spelled out in the value type rather than left to `Partial`, because
 * under `exactOptionalPropertyTypes` those are different things and clearing a field
 * is a real operation here: passing `{ note: undefined }` deletes the note. A plain
 * `Partial` would make that call a type error and push callers into a second action.
 */
export type SetPatch = {
  readonly [K in keyof EditableSetFields]?: EditableSetFields[K] | undefined;
};

export type WorkoutAction =
  | {
      readonly type: 'add_exercise';
      readonly exercise: ExerciseRef;
      /** How many empty sets to lay out. Defaults to three. */
      readonly sets?: number;
      /** Insert at this position in the current order. Defaults to the end. */
      readonly at?: number;
      readonly setType?: SetType;
      readonly now?: number;
    }
  | { readonly type: 'remove_exercise'; readonly exerciseId: WorkoutExerciseId }
  | {
      readonly type: 'move_exercise';
      readonly exerciseId: WorkoutExerciseId;
      readonly toIndex: number;
    }
  | {
      readonly type: 'add_set';
      readonly exerciseId: WorkoutExerciseId;
      /** Insert directly after this set. Defaults to the end of the exercise. */
      readonly after?: SetId | undefined;
      /**
       * Insert at the very top instead. What "add a warmup" means: a warmup appended
       * below three working sets is in the wrong place, and reordering it by hand
       * mid-session is exactly the fiddling this screen exists to avoid.
       */
      readonly atStart?: boolean;
      readonly setType?: SetType;
      readonly now?: number;
    }
  | { readonly type: 'remove_set'; readonly exerciseId: WorkoutExerciseId; readonly setId: SetId }
  | {
      readonly type: 'move_set';
      readonly exerciseId: WorkoutExerciseId;
      readonly setId: SetId;
      readonly toIndex: number;
    }
  | {
      readonly type: 'edit_set';
      readonly exerciseId: WorkoutExerciseId;
      readonly setId: SetId;
      readonly patch: SetPatch;
    }
  | {
      /**
       * The one-tap path. Commits whatever the row was showing — including a ghost the
       * user never touched — and marks the set attempted.
       */
      readonly type: 'set_set_state';
      readonly exerciseId: WorkoutExerciseId;
      readonly setId: SetId;
      readonly state: SetState;
      readonly commit?: CommitValues;
      readonly restSecBefore?: number;
      readonly now?: number;
    }
  | { readonly type: 'undo_removal' }
  | {
      readonly type: 'set_exercise_rest';
      readonly exerciseId: WorkoutExerciseId;
      readonly seconds: number | null;
    }
  | { readonly type: 'set_exercise_note'; readonly exerciseId: WorkoutExerciseId; readonly note: string }
  | { readonly type: 'set_bodyweight'; readonly kg: number | null }
  | { readonly type: 'set_title'; readonly title: string }
  | { readonly type: 'set_session_rpe'; readonly rpe: number | null }
  | { readonly type: 'finish'; readonly now?: number }
  | { readonly type: 'discard'; readonly now?: number }
  | {
      /**
       * Clear the decks and start over.
       *
       * `finish` marks a session completed but leaves it in state, because the screen
       * still has to render what was just saved. Something has to move on afterwards,
       * and this is it — without it the screen sat on a completed workout showing the
       * same exercises and a still-running clock, which read as "Finish did nothing".
       */
      readonly type: 'start_new';
      readonly now?: number;
      readonly bodyweightKg?: number;
    };

export function workoutReducer(state: WorkoutState, action: WorkoutAction): WorkoutState {
  switch (action.type) {
    case 'add_exercise':
      return addExercise(state, action);
    case 'remove_exercise':
      return removeExercise(state, action.exerciseId);
    case 'move_exercise':
      return moveExercise(state, action.exerciseId, action.toIndex);
    case 'add_set':
      return addSet(state, action);
    case 'remove_set':
      return removeSet(state, action.exerciseId, action.setId);
    case 'move_set':
      return moveSet(state, action.exerciseId, action.setId, action.toIndex);
    case 'edit_set':
      return mapSet(state, action.exerciseId, action.setId, (set) => applyPatch(set, action.patch));
    case 'set_set_state':
      return applySetState(state, action);
    case 'undo_removal':
      return undoRemoval(state);
    case 'set_exercise_rest':
      return mapExercise(state, action.exerciseId, (exercise) =>
        action.seconds === null
          ? omit(exercise, 'targetRestSec')
          : { ...exercise, targetRestSec: Math.max(0, Math.round(action.seconds)) },
      );
    case 'set_exercise_note':
      return mapExercise(state, action.exerciseId, (exercise) =>
        action.note === '' ? omit(exercise, 'note') : { ...exercise, note: action.note },
      );
    case 'set_bodyweight':
      return withWorkout(
        state,
        action.kg === null
          ? omit(state.workout, 'bodyweightKg')
          : { ...state.workout, bodyweightKg: action.kg },
      );
    case 'set_title':
      return withWorkout(state, { ...state.workout, title: action.title });
    case 'set_session_rpe':
      return withWorkout(
        state,
        action.rpe === null
          ? omit(state.workout, 'sessionRpe')
          : { ...state.workout, sessionRpe: action.rpe },
      );
    case 'finish':
      return finish(state, action.now ?? Date.now());
    case 'discard':
      return withWorkout(state, {
        ...state.workout,
        status: 'discarded',
        endedAt: action.now ?? Date.now(),
      });
    case 'start_new':
      return startWorkout({
        ...(action.now === undefined ? {} : { now: action.now }),
        ...(action.bodyweightKg === undefined ? {} : { bodyweightKg: action.bodyweightKg }),
      });
  }
}

/* ------------------------------------------------------------------ predicates */

export function totalSetCount(workout: DraftWorkout): number {
  return workout.exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
}

/** The document-level caps, mirrored from `workout.ts` and `firestore.rules`. */
export function canAddExercise(workout: DraftWorkout): boolean {
  return workout.exercises.length < MAX_EXERCISES_PER_WORKOUT;
}

export function canAddSet(workout: DraftWorkout, exerciseId: WorkoutExerciseId): boolean {
  const exercise = workout.exercises.find((candidate) => candidate.id === exerciseId);
  if (exercise === undefined) return false;
  return exercise.sets.length < MAX_SETS_PER_EXERCISE && totalSetCount(workout) < MAX_SETS_PER_WORKOUT;
}

/**
 * What the row's log button does: log the set, or take the log back.
 *
 * **This used to be a three-state cycle** — `pending -> completed -> failed ->
 * pending` — on a control with no visible label. A user tapped it twice, landed on
 * `failed`, and read the large red cross as a delete button sitting where the primary
 * action should be. Two taps of the commonest control in the product put them in a
 * state that looked destructive and had no obvious way out.
 *
 * Making a set is the common case; missing one is rare. They should not be adjacent
 * taps on the same unlabelled control. So the button is now a toggle — made, or not
 * yet — and `failed` is reached from the set editor, where it is a word rather than a
 * colour. From `failed`, one tap still returns to untouched, so there is never a state
 * the button cannot get you out of.
 *
 * All three states survive; only the route to `failed` changed. It still feeds
 * progression and volume (ADR-0025), and `setStateOptions` below is what offers it.
 */
export function toggleSetLogged(current: SetState): SetState {
  return current === 'completed' || current === 'failed' ? 'pending' : 'completed';
}

/**
 * The three states as a labelled choice, for the editor's state control.
 *
 * The words are the point. `NEXT_ACTION` in `SetRow` already held them, but only as
 * an `aria-label` — so the one user group that never got told what the control did was
 * the sighted one. Ordered as the lifter thinks: the outcome they wanted, the outcome
 * they got, and not yet.
 */
export const SET_STATE_OPTIONS: readonly { readonly value: SetState; readonly label: string }[] = [
  { value: 'completed', label: 'Made' },
  { value: 'failed', label: 'Missed' },
  { value: 'pending', label: 'Not yet' },
];

/* --------------------------------------------------------------- session length */

/**
 * How long a session may sit with nothing logged before it is over.
 *
 * A real user's clock read **39:22:01**. A session left open counts wall clock for as
 * long as the app is installed, and nothing capped it, prompted a finish, or resumed
 * sanely the next day — so every duration statistic downstream was wrong, and the
 * header made the most-read number on the screen absurd.
 *
 * Four hours, and the rule is deliberately *idle time* rather than total length or the
 * calendar day. Both of the obvious alternatives are wrong in a case that really
 * happens: a total-length cap cuts off a genuine five-hour meet, and a day-boundary
 * rule ends a session that started at 23:30 and is still going at 00:15. Nobody rests
 * four hours between sets; four hours of silence means the lifter went home.
 */
export const SESSION_IDLE_MS = 4 * 60 * 60 * 1000;

/**
 * When the lifter last actually did something, or `startedAt` if they never did.
 *
 * `performedAt` is the only honest activity signal on a draft — it is written exactly
 * when a set is logged, and cleared when a set is put back to pending.
 */
export function lastActivityAt(workout: DraftWorkout): number {
  let latest = workout.startedAt;
  for (const exercise of workout.exercises) {
    for (const set of exercise.sets) {
      if (set.performedAt !== undefined && set.performedAt > latest) latest = set.performedAt;
    }
  }
  return latest;
}

/**
 * Has this session been abandoned?
 *
 * Asked on resume, before the screen paints. A stale session is not resumed: if it has
 * logged work it is closed and filed, and if it does not it is dropped.
 */
export function isStale(workout: DraftWorkout, now: number): boolean {
  return now - lastActivityAt(workout) > SESSION_IDLE_MS;
}

/**
 * The instant a session ended, which is not the same as the instant Finish was tapped.
 *
 * Bounded by the last logged set plus the idle grace, so a phone left in a locker
 * cannot write a 39-hour workout into history and skew every duration average that
 * reads it. For a session finished while the lifter is still standing there — every
 * normal one — `now` is well inside the bound and this returns `now` unchanged.
 */
export function endedAtFor(workout: DraftWorkout, now: number): number {
  const bound = lastActivityAt(workout) + SESSION_IDLE_MS;
  return Math.max(workout.startedAt, Math.min(now, bound));
}

/**
 * Has anything actually been logged?
 *
 * The gate on finishing. A session where the lifter opened the app and added an
 * exercise but never logged a set is not a workout, and writing one to history puts a
 * phantom session into the streak and the session count that insights reads.
 */
export function hasLoggedWork(workout: DraftWorkout): boolean {
  return workout.exercises.some((exercise) =>
    exercise.sets.some((set) => set.state !== 'pending'),
  );
}

/** Sets in their authoritative order. Array position is never trusted. */
export function orderedSets(exercise: DraftExercise): DraftSet[] {
  return sortedByKey(exercise.sets);
}

/** Exercises in their authoritative order. */
export function orderedExercises(workout: DraftWorkout): DraftExercise[] {
  return sortedByKey(workout.exercises);
}

/* -------------------------------------------------------------------- internals */

function addExercise(
  state: WorkoutState,
  action: Extract<WorkoutAction, { type: 'add_exercise' }>,
): WorkoutState {
  if (!canAddExercise(state.workout)) return state;

  const now = action.now ?? Date.now();
  const existing = orderedExercises(state.workout);
  const index = clampIndex(action.at ?? existing.length, existing.length);
  const sortKey = keyAt(existing, index);

  const setCount = Math.max(0, Math.min(action.sets ?? 3, MAX_SETS_PER_EXERCISE));
  const room = Math.max(0, MAX_SETS_PER_WORKOUT - totalSetCount(state.workout));
  const sets: DraftSet[] = [];
  let previousKey: SortKey | null = null;
  for (let i = 0; i < Math.min(setCount, room); i += 1) {
    previousKey = sortKeyBetween(previousKey, null);
    sets.push(emptySet(action.exercise, previousKey, action.setType ?? 'working', now));
  }

  const exercise: DraftExercise = {
    id: newWorkoutExerciseId(now),
    sortKey,
    exercise: action.exercise,
    sets,
  };

  return withWorkout(state, {
    ...state.workout,
    exercises: sortedByKey([...state.workout.exercises, exercise]),
  });
}

function removeExercise(state: WorkoutState, exerciseId: WorkoutExerciseId): WorkoutState {
  const exercise = state.workout.exercises.find((candidate) => candidate.id === exerciseId);
  if (exercise === undefined) return state;

  return {
    workout: {
      ...state.workout,
      exercises: state.workout.exercises.filter((candidate) => candidate.id !== exerciseId),
    },
    undoStack: pushUndo(state.undoStack, {
      kind: 'exercise',
      exercise,
      label: exercise.exercise.name,
    }),
  };
}

function moveExercise(
  state: WorkoutState,
  exerciseId: WorkoutExerciseId,
  toIndex: number,
): WorkoutState {
  const ordered = orderedExercises(state.workout);
  const from = ordered.findIndex((candidate) => candidate.id === exerciseId);
  if (from === -1) return state;

  const without = ordered.filter((candidate) => candidate.id !== exerciseId);
  const target = clampIndex(toIndex, without.length);
  const moved = ordered[from] as DraftExercise;

  return withWorkout(state, {
    ...state.workout,
    exercises: sortedByKey([...without, { ...moved, sortKey: keyAt(without, target) }]),
  });
}

function addSet(
  state: WorkoutState,
  action: Extract<WorkoutAction, { type: 'add_set' }>,
): WorkoutState {
  if (!canAddSet(state.workout, action.exerciseId)) return state;
  const now = action.now ?? Date.now();

  return mapExercise(state, action.exerciseId, (exercise) => {
    const ordered = orderedSets(exercise);
    let index: number;
    if (action.atStart === true) {
      index = 0;
    } else {
      const afterIndex =
        action.after === undefined
          ? ordered.length - 1
          : ordered.findIndex((candidate) => candidate.id === action.after);
      index = afterIndex === -1 ? ordered.length : afterIndex + 1;
    }

    // A new set inherits the type of the one it follows, so "add another" after a
    // warmup gives another warmup rather than silently starting the working sets.
    const template = index === 0 ? undefined : ordered[index - 1];
    const setType = action.setType ?? template?.type ?? 'working';

    const created = emptySet(exercise.exercise, keyAt(ordered, index), setType, now);
    return { ...exercise, sets: sortedByKey([...exercise.sets, created]) };
  });
}

function removeSet(
  state: WorkoutState,
  exerciseId: WorkoutExerciseId,
  setId: SetId,
): WorkoutState {
  const exercise = state.workout.exercises.find((candidate) => candidate.id === exerciseId);
  const set = exercise?.sets.find((candidate) => candidate.id === setId);
  if (exercise === undefined || set === undefined) return state;

  const index = orderedSets(exercise).findIndex((candidate) => candidate.id === setId);
  const next = mapExercise(state, exerciseId, (current) => ({
    ...current,
    sets: current.sets.filter((candidate) => candidate.id !== setId),
  }));

  return {
    workout: next.workout,
    undoStack: pushUndo(state.undoStack, {
      kind: 'set',
      exerciseId,
      set,
      label: `${exercise.exercise.name} set ${index + 1}`,
    }),
  };
}

function moveSet(
  state: WorkoutState,
  exerciseId: WorkoutExerciseId,
  setId: SetId,
  toIndex: number,
): WorkoutState {
  return mapExercise(state, exerciseId, (exercise) => {
    const ordered = orderedSets(exercise);
    const from = ordered.findIndex((candidate) => candidate.id === setId);
    if (from === -1) return exercise;

    const without = ordered.filter((candidate) => candidate.id !== setId);
    const target = clampIndex(toIndex, without.length);
    const moved = ordered[from] as DraftSet;

    // Only the moved set's key changes. Everything the lifter typed into every other
    // set is untouched, which is the entire point of a fractional index.
    return { ...exercise, sets: sortedByKey([...without, { ...moved, sortKey: keyAt(without, target) }]) };
  });
}

function applySetState(
  state: WorkoutState,
  action: Extract<WorkoutAction, { type: 'set_set_state' }>,
): WorkoutState {
  const now = (action.now ?? Date.now()) as EpochMillis;

  return mapSet(state, action.exerciseId, action.setId, (set) => {
    // Committing first means the one-tap path works: the row was showing last
    // session's numbers as a ghost, the lifter tapped the button, and those numbers
    // become real. A field the lifter already typed into is never overwritten.
    const committed = commitInto(set, action.commit);

    if (action.state === 'pending') {
      // Back to untouched. The numbers stay; only the attempt is forgotten, which is
      // what `performedAt must be set if and only if the set has been attempted`
      // requires and what stops a mis-tap costing the lifter their entry.
      const cleared = omit(omit(committed, 'performedAt'), 'restSecBefore');
      return { ...cleared, state: 'pending' };
    }

    return {
      ...committed,
      state: action.state,
      performedAt: now,
      ...(action.restSecBefore === undefined
        ? {}
        : { restSecBefore: Math.max(0, Math.round(action.restSecBefore)) }),
    };
  });
}

function undoRemoval(state: WorkoutState): WorkoutState {
  const [removal, ...rest] = state.undoStack;
  if (removal === undefined) return state;

  if (removal.kind === 'exercise') {
    return {
      workout: {
        ...state.workout,
        exercises: sortedByKey([...state.workout.exercises, removal.exercise]),
      },
      undoStack: rest,
    };
  }

  const restored = mapExercise(state, removal.exerciseId, (exercise) => ({
    ...exercise,
    sets: sortedByKey([...exercise.sets, removal.set]),
  }));
  return { workout: restored.workout, undoStack: rest };
}

function finish(state: WorkoutState, now: number): WorkoutState {
  return withWorkout(state, {
    ...state.workout,
    status: 'completed',
    /*
     * Not `now`. `endedAtFor` floors at `startedAt`, because `endedAt must not precede
     * startedAt` and a device clock that went backwards mid-session must not produce a
     * document the schema will reject — and it caps at the last logged set plus the
     * idle grace, because a session the lifter walked away from six hours ago did not
     * last six hours and history should not say it did.
     */
    endedAt: endedAtFor(state.workout, now),
  });
}

function emptySet(
  exercise: ExerciseRef,
  sortKey: SortKey,
  type: SetType,
  now: number,
): DraftSet {
  return {
    id: newSetId(now),
    sortKey,
    type,
    state: 'pending',
    loadKind: exercise.loadKind,
    effortKind: exercise.effortKind,
    weightKg: null,
    reps: null,
    durationSec: null,
    distanceM: null,
  };
}

/** Fill only the fields the lifter has left empty. A typed value always wins. */
function commitInto(set: DraftSet, commit: CommitValues | undefined): DraftSet {
  if (commit === undefined) return set;
  return {
    ...set,
    weightKg: set.weightKg ?? commit.weightKg ?? null,
    reps: set.reps ?? commit.reps ?? null,
    durationSec: set.durationSec ?? commit.durationSec ?? null,
    distanceM: set.distanceM ?? commit.distanceM ?? null,
  };
}

function applyPatch(set: DraftSet, patch: SetPatch): DraftSet {
  let next: DraftSet = set;
  for (const [key, value] of Object.entries(patch) as [keyof EditableSetFields, unknown][]) {
    if (value === undefined) {
      next = omit(next, key) as DraftSet;
    } else {
      next = { ...next, [key]: value };
    }
  }
  return next;
}

function pushUndo(stack: readonly Removal[], removal: Removal): Removal[] {
  return [removal, ...stack].slice(0, MAX_UNDO);
}

function withWorkout(state: WorkoutState, workout: DraftWorkout): WorkoutState {
  return { workout, undoStack: state.undoStack };
}

function mapExercise(
  state: WorkoutState,
  exerciseId: WorkoutExerciseId,
  update: (exercise: DraftExercise) => DraftExercise,
): WorkoutState {
  let touched = false;
  const exercises = state.workout.exercises.map((exercise) => {
    if (exercise.id !== exerciseId) return exercise;
    const updated = update(exercise);
    // Identity, not just presence. An update that changed nothing — an edit aimed at
    // a set that is not there — must return the *same* state object, or every such
    // no-op re-renders the whole session list.
    if (updated !== exercise) touched = true;
    return updated;
  });
  return touched ? withWorkout(state, { ...state.workout, exercises }) : state;
}

function mapSet(
  state: WorkoutState,
  exerciseId: WorkoutExerciseId,
  setId: SetId,
  update: (set: DraftSet) => DraftSet,
): WorkoutState {
  return mapExercise(state, exerciseId, (exercise) => {
    let touched = false;
    const sets = exercise.sets.map((set) => {
      if (set.id !== setId) return set;
      touched = true;
      return update(set);
    });
    return touched ? { ...exercise, sets } : exercise;
  });
}

/**
 * A key that sorts into position `index` of an already-ordered list.
 *
 * `sortKeyBetween` derives it from the two neighbours alone, so inserting mutates one
 * field on one new object and renumbers nothing.
 */
function keyAt(ordered: readonly { readonly sortKey: SortKey }[], index: number): SortKey {
  const before = index > 0 ? (ordered[index - 1]?.sortKey ?? null) : null;
  const after = ordered[index]?.sortKey ?? null;
  // Two devices can legitimately produce the same key in the same gap — that is the
  // merge-as-a-union behaviour the fractional index is for, and `sortedByKey` breaks
  // the tie on id. `sortKeyBetween` throws on a non-increasing pair, though, so a
  // duplicate that has synced in must not be allowed to blow up an insert mid-set.
  if (before !== null && after !== null && before >= after) return sortKeyBetween(before, null);
  return sortKeyBetween(before, after);
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.max(0, Math.min(Math.trunc(index), length));
}

/** Delete a key, rather than setting it to `undefined` — `exactOptionalPropertyTypes`. */
function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> & Partial<Pick<T, K>> {
  const { [key]: _removed, ...rest } = value;
  return rest as Omit<T, K> & Partial<Pick<T, K>>;
}

function defaultTitle(at: Date): string {
  const hour = at.getHours();
  if (hour < 12) return 'Morning session';
  if (hour < 17) return 'Afternoon session';
  return 'Evening session';
}
