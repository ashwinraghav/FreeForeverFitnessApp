import { Button, EmptyState, PlusGlyph, Toast, ToastRegion } from '@freeforever/design-system';
import type { SetId, SetState, WorkoutExerciseId } from '@freeforever/data';
import { sessionTotals } from '@freeforever/core';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import { STARTER_CATALOGUE } from '../catalogue/starter.js';
import { toExerciseRef, type CatalogueEntry } from '../catalogue/types.js';
import { ExerciseCard } from '../components/ExerciseCard.js';
import { ExercisePicker } from '../components/ExercisePicker.js';
import type { EditableField } from '../components/SetRow.js';
import { recordsThisSession, suggestionFor, suggestionLine } from '../model/coaching.js';
import { commitValuesFor, ghostsForExercise } from '../model/ghosts.js';
import {
  historyFor,
  recentExerciseIds,
  toCompletedSession,
  toPerformedSet,
} from '../model/history.js';
import { localDateOf } from '../model/ids.js';
import {
  canAddExercise,
  canAddSet,
  orderedExercises,
  startWorkout,
  workoutReducer,
} from '../model/session.js';
import type { WorkoutState } from '../model/types.js';
import type { WorkoutRepository } from '../storage/workoutStore.js';
import { primeAudio, SET_LOGGED_PATTERN, vibrate } from '../timer/feedback.js';
import { RestBar } from '../timer/RestBar.js';
import { DEFAULT_REST_SEC } from '../timer/restTimer.js';
import { useRestTimer } from '../timer/useRestTimer.js';

/**
 * The active workout screen.
 *
 * The one number that matters for this screen is **ten seconds from a cold start to a
 * logged set**, so the path it optimises is: open the app, the session that was in
 * progress is already on screen with last session's numbers ghosted in, tap the log
 * button. Two taps if the app was closed, one if it was not.
 *
 * Everything else follows from the same constraint:
 *
 *   - **Every mutation is persisted immediately.** Not debounced, not on unmount —
 *     the app can be killed between any two frames and the session has to survive it.
 *     A 40-set session is a few kilobytes of JSON; the write is not the bottleneck.
 *   - **No modals.** The picker is a non-blocking `Sheet`; the set editor is a row in
 *     the list; removal is undone from a toast rather than confirmed in a dialog.
 *   - **Everything frequent is in the bottom third.** The finish button is in a fixed
 *     bar at the bottom, never a top-right "Done".
 */

export interface ActiveWorkoutScreenProps {
  readonly repository: WorkoutRepository;
  readonly catalogue?: readonly CatalogueEntry[];
  /** Smallest load step this gym can make, kg. From the profile's unit preferences. */
  readonly loadStepKg?: number;
  /** Injectable clock, for tests. */
  readonly now?: () => number;
  readonly onFinished?: () => void;
}

interface OpenEditor {
  readonly setId: SetId;
  readonly field: EditableField;
}

export function ActiveWorkoutScreen({
  repository,
  catalogue = STARTER_CATALOGUE,
  loadStepKg = 2.5,
  now = Date.now,
  onFinished,
}: ActiveWorkoutScreenProps) {
  // Resume straight out of storage in the initialiser rather than in an effect, so a
  // cold start paints the session that was in progress on the first frame instead of
  // flashing an empty screen at someone standing under a bar.
  const [state, dispatch] = useReducer(workoutReducer, undefined, (): WorkoutState => {
    const resumed = repository.loadActive();
    return resumed === null ? startWorkout({ now: now() }) : { workout: resumed, undoStack: [] };
  });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [openEditor, setOpenEditor] = useState<OpenEditor | null>(null);
  const [undoOffer, setUndoOffer] = useState<string | null>(null);

  const history = useMemo(() => repository.loadHistory(), [repository]);
  const recentIds = useMemo(() => recentExerciseIds(history), [history]);
  const today = useMemo(() => localDateOf(new Date(now())), [now]);

  const timer = useRestTimer({ repository, now });

  // Persist on every state change. The alternative — debouncing — trades the one
  // guarantee this screen exists to provide for a saving that does not matter.
  useEffect(() => {
    repository.saveActive(state.workout.status === 'in_progress' ? state.workout : null);
  }, [repository, state.workout]);

  const exercises = orderedExercises(state.workout);

  const totals = useMemo(
    () =>
      sessionTotals(
        exercises.map((exercise) => ({
          exercise: exercise.exercise,
          sets: exercise.sets.map(toPerformedSet),
        })),
        state.workout.bodyweightKg === undefined
          ? {}
          : { bodyweightKg: state.workout.bodyweightKg },
      ),
    [exercises, state.workout.bodyweightKg],
  );

  const changeSetState = useCallback(
    (exerciseId: WorkoutExerciseId, setId: SetId, next: SetState) => {
      const exercise = state.workout.exercises.find((candidate) => candidate.id === exerciseId);
      const set = exercise?.sets.find((candidate) => candidate.id === setId);
      if (exercise === undefined || set === undefined) return;

      // The ghost is resolved here, at the moment of the tap, and handed to the
      // reducer as an explicit commit. That is the only path by which a carried-over
      // number ever becomes logged data.
      const ghost = ghostsForExercise(exercise, history).get(setId);
      const commit = commitValuesFor(set, ghost);

      // Stop the rest that was running and log how long it actually was. Measured,
      // not prescribed: a lifter who sat for four minutes on a 90-second timer gets 240.
      const restTaken = next === 'pending' ? null : timer.stop();

      dispatch({
        type: 'set_set_state',
        exerciseId,
        setId,
        state: next,
        commit,
        now: now(),
        ...(restTaken === null ? {} : { restSecBefore: restTaken }),
      });

      if (next === 'pending') return;

      // The tap is a real user gesture, which is the only moment an AudioContext can
      // be unlocked. Prime it here or the rest alarm is silent two minutes later with
      // no error anywhere.
      primeAudio();
      vibrate(SET_LOGGED_PATTERN);

      if (next === 'completed') {
        timer.start(exerciseId, setId, exercise.targetRestSec ?? DEFAULT_REST_SEC);
      }
      setOpenEditor(null);
    },
    [state.workout.exercises, history, timer, now],
  );

  const addExercise = useCallback(
    (entry: CatalogueEntry) => {
      dispatch({ type: 'add_exercise', exercise: toExerciseRef(entry), now: now() });
      setPickerOpen(false);
    },
    [now],
  );

  const removeExercise = useCallback((exerciseId: WorkoutExerciseId) => {
    const exercise = state.workout.exercises.find((candidate) => candidate.id === exerciseId);
    dispatch({ type: 'remove_exercise', exerciseId });
    setUndoOffer(exercise === undefined ? 'Removed' : `Removed ${exercise.exercise.name}`);
  }, [state.workout.exercises]);

  const removeSet = useCallback((exerciseId: WorkoutExerciseId, setId: SetId) => {
    dispatch({ type: 'remove_set', exerciseId, setId });
    setOpenEditor(null);
    setUndoOffer('Removed set');
  }, []);

  const finish = useCallback(() => {
    const finished = workoutReducer(state, { type: 'finish', now: now() });
    repository.appendHistory(toCompletedSession(finished.workout));
    repository.saveActive(null);
    repository.saveRest(null);
    dispatch({ type: 'finish', now: now() });
    onFinished?.();
  }, [state, repository, now, onFinished]);

  const restingExercise =
    timer.rest === null
      ? null
      : (state.workout.exercises.find((candidate) => candidate.id === timer.rest?.exerciseId) ?? null);

  return (
    <div className="ffw-screen">
      <header className="ffw-screen__header">
        <h2 className="ffw-screen__title">{state.workout.title}</h2>
        <span className="ffw-elapsed">{elapsed(state.workout.startedAt, now())}</span>
      </header>

      <div className="ffw-summary">
        <span>
          <span className="ffw-summary__value">{totals.completedSetCount}</span> sets
        </span>
        <span>
          <span className="ffw-summary__value">{Math.round(totals.volumeKg)}</span> kg
        </span>
        <span>
          <span className="ffw-summary__value">{totals.exerciseCount}</span> exercises
        </span>
      </div>

      {exercises.length === 0 ? (
        <EmptyState
          title="Nothing logged yet"
          body="Add the first lift and the app will carry your last numbers over next time."
          action={
            <Button size="xl" variant="primary" onClick={() => setPickerOpen(true)}>
              <PlusGlyph aria-hidden="true" /> Add exercise
            </Button>
          }
        />
      ) : (
        exercises.map((exercise, position) => (
          <ExerciseCard
            key={exercise.id}
            exercise={exercise}
            position={position}
            total={exercises.length}
            ghosts={ghostsForExercise(exercise, history)}
            history={historyFor(exercise.exercise, history)}
            today={today}
            suggestion={suggestionLine(
              suggestionFor(exercise.exercise, history, loadStepKg),
            )}
            records={recordsThisSession(exercise, state.workout, history).map(
              (record) => record.type,
            )}
            openEditor={openEditor}
            canAddSet={canAddSet(state.workout, exercise.id)}
            loadStepKg={loadStepKg}
            onOpenEditor={(setId, field) =>
              setOpenEditor(field === null ? null : { setId, field })
            }
            onChangeSetState={(setId, next) => changeSetState(exercise.id, setId, next)}
            onEditSet={(setId, patch) =>
              dispatch({ type: 'edit_set', exerciseId: exercise.id, setId, patch })
            }
            onRemoveSet={(setId) => removeSet(exercise.id, setId)}
            onAddSet={(kind) =>
              dispatch({ type: 'add_set', exerciseId: exercise.id, setType: kind, now: now() })
            }
            onRemoveExercise={removeExercise}
            onMoveExercise={(exerciseId, toIndex) =>
              dispatch({ type: 'move_exercise', exerciseId, toIndex })
            }
          />
        ))
      )}

      {/*
        The action bar is fixed to the bottom, and lifts above the rest bar when one is
        showing. Frequent actions live in the reachable third; there is never a
        top-right "Done" (ADR-0013).
      */}
      <div className={timer.rest === null ? 'ffw-actions' : 'ffw-actions ffw-actions--stacked'}>
        <Button
          size="xl"
          variant="secondary"
          disabled={!canAddExercise(state.workout)}
          onClick={() => setPickerOpen(true)}
        >
          <PlusGlyph aria-hidden="true" /> Exercise
        </Button>
        <Button size="xl" variant="primary" onClick={finish} disabled={exercises.length === 0}>
          Finish
        </Button>
      </div>

      {timer.rest === null ? null : (
        <RestBar
          rest={timer.rest}
          now={timer.now}
          forLabel={restingExercise?.exercise.name ?? 'set'}
          onAdjust={timer.adjust}
          onSkip={() => timer.stop()}
        />
      )}

      <ExercisePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={addExercise}
        catalogue={catalogue}
        recentIds={recentIds}
      />

      {undoOffer === null ? null : (
        <ToastRegion>
          <Toast
            tone="info"
            durationMs={8000}
            onDismiss={() => setUndoOffer(null)}
            action={
              <Button
                size="lg"
                variant="ghost"
                onClick={() => {
                  dispatch({ type: 'undo_removal' });
                  setUndoOffer(null);
                }}
              >
                Undo
              </Button>
            }
          >
            {undoOffer}
          </Toast>
        </ToastRegion>
      )}
    </div>
  );
}

/** `0:42`, `1:07:30`. Wall clock since the first tap. */
export function elapsed(startedAt: number, at: number): string {
  const seconds = Math.max(0, Math.floor((at - startedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, '0');
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(rest).padStart(2, '0')}`;
}
