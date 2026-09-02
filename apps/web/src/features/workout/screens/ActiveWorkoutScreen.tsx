import { Button, EmptyState, PlusGlyph, Toast, ToastRegion } from '@freeforever/design-system';
import type { SetId, SetState, WorkoutExerciseId } from '@freeforever/data';
import { hardSetCount, sessionTotals } from '@freeforever/core';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { Link } from 'react-router-dom';

import { notifyLocalDataChanged } from '../../../data/insightsSource.js';
import { useCatalogue } from '../catalogue/useCatalogue.js';
import { toExerciseRef, type CatalogueEntry } from '../catalogue/types.js';
import { ExerciseCard } from '../components/ExerciseCard.js';
import { ExercisePicker } from '../components/ExercisePicker.js';
import { recommendedExerciseIds } from '../model/recommend.js';
import type { EditableField } from '../components/SetRow.js';
import { recordsThisSession, suggestionFor, suggestionLine } from '../model/coaching.js';
import { commitValuesFor, ghostsForExercise } from '../model/ghosts.js';
import type { CompletedSession } from '../model/history.js';
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
  endedAtFor,
  hasLoggedWork,
  isStale,
  orderedExercises,
  startWorkout,
  workoutReducer,
} from '../model/session.js';
import { SessionSummary } from './SessionSummary.js';
import type { DraftWorkout, WorkoutState } from '../model/types.js';
import type { WorkoutRepository } from '../storage/workoutStore.js';
import { primeAudio, SET_LOGGED_PATTERN, vibrate } from '../timer/feedback.js';
import { RestBar } from '../timer/RestBar.js';
import { DEFAULT_REST_SEC } from '../timer/restTimer.js';
import { useSessionClock } from '../timer/useSessionClock.js';
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
  catalogue: catalogueProp,
  loadStepKg = 2.5,
  now = Date.now,
  onFinished,
}: ActiveWorkoutScreenProps) {
  // Resume straight out of storage during the first render rather than in an effect,
  // so a cold start paints the session that was in progress on the first frame instead
  // of flashing an empty screen at someone standing under a bar. `useState` with an
  // initialiser runs once, and `resumeSession` is idempotent, so React's development
  // double-invoke costs nothing.
  const [resumed] = useState(() => resumeSession(repository, now()));
  const [state, dispatch] = useReducer(workoutReducer, resumed.state);
  const [recovered, setRecovered] = useState<string | null>(resumed.recoveredTitle);

  // The header clock ticks on its own. It used to re-render only when the rest timer did,
  // so tapping Done froze the elapsed time until something else touched the screen.
  const sessionNow = useSessionClock(state.workout.endedAt === undefined, now);

  // Tests and stories can pin the list; everything else gets the full ~900.
  const loaded = useCatalogue();
  const catalogue = catalogueProp ?? loaded;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [openEditor, setOpenEditor] = useState<OpenEditor | null>(null);
  const [undoOffer, setUndoOffer] = useState<string | null>(null);
  /**
   * The session that was just saved, held only long enough to show it.
   *
   * Kept in screen state rather than in the reducer because it is not a workout being
   * edited — it is a receipt. The reducer moves straight on to a fresh session.
   */
  const [justFinished, setJustFinished] = useState<{
    readonly workout: DraftWorkout;
    readonly priorSessions: readonly CompletedSession[];
  } | null>(null);

  const history = useMemo(() => repository.loadHistory(), [repository]);
  const recentIds = useMemo(() => recentExerciseIds(history), [history]);
  /*
   * The light-touch coach: the picker leads with muscles the last few sessions left
   * short. Exercises already in this session are excluded — recommending what is
   * on screen would be noise.
   */
  const recommendedIds = useMemo(
    () =>
      recommendedExerciseIds(history, catalogue, {
        excludeIds: state.workout.exercises.map((exercise) => exercise.exercise.exerciseId),
      }),
    [history, catalogue, state.workout.exercises],
  );
  const today = useMemo(() => localDateOf(new Date(now())), [now]);

  const timer = useRestTimer({ repository, now });

  // Persist on every state change. The alternative — debouncing — trades the one
  // guarantee this screen exists to provide for a saving that does not matter.
  useEffect(() => {
    repository.saveActive(state.workout.status === 'in_progress' ? state.workout : null);
  }, [repository, state.workout]);

  const exercises = orderedExercises(state.workout);

  /*
   * Equipment, resolved from the catalogue.
   *
   * `ExerciseRef` carries `loadKind` but not `equipment`, which is why the plate
   * hint originally keyed off `loadKind === 'external'` — and why it offered
   * "20 kg bar, each side" on lateral raises, since a dumbbell is externally
   * loaded too. The catalogue is already on this screen for the picker, so the
   * real answer is one lookup away.
   */
  const equipmentById = useMemo(
    () => new Map(catalogue.map((entry) => [entry.id, entry.equipment])),
    [catalogue],
  );

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

  /**
   * Sets the header can honestly put next to the tonnage.
   *
   * `hardSetCount` is core's own name for "a working set that was actually attempted",
   * and it is the same predicate `volumeKg` is summed over — which is the whole point:
   * see the comment on `.ffw-summary` below for the "0 sets · 300 kg" it replaces.
   */
  const loggedSetCount = useMemo(
    () => hardSetCount(exercises.flatMap((exercise) => exercise.sets.map(toPerformedSet))),
    [exercises],
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
    // Nothing logged is not a workout. Writing one puts a phantom session into the
    // streak and the session count that insights reads off the history.
    if (!hasLoggedWork(state.workout)) return;

    const finished = workoutReducer(state, { type: 'finish', now: now() });
    // Snapshot the history *before* appending, so the summary's record detection
    // compares this session against what came before rather than against itself.
    setJustFinished({ workout: finished.workout, priorSessions: repository.loadHistory() });
    repository.putSession(toCompletedSession(finished.workout));
    repository.saveActive(null);
    /*
     * Tell an open Progress tab, in this tab.
     *
     * `insightsSource` re-validates against the raw history string on every read, so
     * Progress is correct without this — but only from its next render. The `storage`
     * event that would otherwise wake it deliberately does not fire in the tab that
     * wrote. `notifyLocalDataChanged` is that module's own exported call for exactly
     * this, so using it is consuming their API rather than editing their file, which is
     * the right side of the ADR-0018 line.
     */
    notifyLocalDataChanged();
    /*
     * Through the hook, not `repository.saveRest(null)`.
     *
     * Writing the storage directly reaches around `useRestTimer`, which keeps the
     * timer in React state: the bar carried on counting into the next session with
     * its label degraded to "Rest · set", because the exercise it named was gone.
     * And the clear did not even stick — the hook re-persists on its next alarm
     * transition, so a reload could resurrect a countdown belonging to a workout
     * that had already been saved.
     */
    timer.stop();
    dispatch({ type: 'finish', now: now() });
    onFinished?.();
  }, [state, repository, now, onFinished, timer]);

  const startNext = useCallback(() => {
    setJustFinished(null);
    setOpenEditor(null);
    setUndoOffer(null);
    // Belt and braces: a rest can only survive to here via a path that skipped
    // `finish`, but a new session must never inherit the last one's countdown.
    timer.stop();
    dispatch({
      type: 'start_new',
      now: now(),
      ...(state.workout.bodyweightKg === undefined
        ? {}
        : { bodyweightKg: state.workout.bodyweightKg }),
    });
  }, [now, state.workout.bodyweightKg, timer]);

  const logged = hasLoggedWork(state.workout);

  const restingExercise =
    timer.rest === null
      ? null
      : (state.workout.exercises.find((candidate) => candidate.id === timer.rest?.exerciseId) ?? null);

  if (justFinished !== null) {
    return (
      <SessionSummary
        workout={justFinished.workout}
        priorSessions={justFinished.priorSessions}
        onStartNext={startNext}
      />
    );
  }

  return (
    <div className="ffw-screen">
      <header className="ffw-screen__header">
        <h2 className="ffw-screen__title">{state.workout.title}</h2>
        {/*
          * The clock and the way into history, grouped so the header is two flex items
          * rather than three.
          *
          * A third item in a tight header is how the shell's tab bar came to scroll the
          * whole document sideways at 200% text, so this one is built to wrap: the group
          * is its own flex line, and `.ffw-screen__header` wraps rather than overflowing.
          * Verified in a browser at 412px and 200%, because nothing in the suite can see
          * it.
          */}
        <span className="ffw-screen__meta">
        {/* `clockAt` wins over a raw `now()`: `endedAt` stops the clock on a finished
            session, and the idle cap stops it on one left open in a locker — a header
            reading 39:22:01 is how this screen most visibly lies. */}
          <span className="ffw-elapsed">
            {elapsed(state.workout.startedAt, clockAt(state.workout, sessionNow))}
          </span>
          {/*
            A link, not a button: it navigates, so middle-click and long-press-to-open
            should behave the way they do everywhere else. Sized to the 48px floor in
            CSS — it is not tapped mid-set, so it does not need the 56px.
          */}
          <Link className="ffw-headerlink ff-focusable" to="history">
            History
          </Link>
        </span>
      </header>

      {/*
        * The set count and the volume must describe the same sets.
        *
        * They did not. This line read **"0 sets · 300 kg"** for a lifter who had marked
        * three sets missed: `completedSetCount` excludes a missed set while `volumeKg`
        * includes it. Both are right — a missed set moved the bar, so it is fatigue and
        * it belongs in the tonnage (ADR-0025, and `volume.ts` in core) — but printed
        * side by side they read as a bug, and a number that looks broken stops being
        * read at all.
        *
        * So the count is now `hardSetCount`: working sets that were attempted, made or
        * missed. Precisely the population `volumeKg` sums over, so the two can no
        * longer disagree, and warmups stop being counted as sets that contributed no
        * tonnage. The volume rule itself is untouched.
        *
        * Missed sets then get their own figure rather than being folded away silently
        * — the lifter should be able to see that four of their sets included one they
        * did not make.
        */}
      <div className="ffw-summary">
        <span>
          <span className="ffw-summary__value">{loggedSetCount}</span> sets
        </span>
        {totals.failedSetCount === 0 ? null : (
          <span className="ffw-summary__missed">{totals.failedSetCount} missed</span>
        )}
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
            equipment={equipmentById.get(exercise.exercise.exerciseId)}
            position={position}
            total={exercises.length}
            ghosts={ghostsForExercise(exercise, history)}
            history={historyFor(exercise.exercise, history)}
            today={today}
            /*
             * Advice for *before* the exercise starts, and only then. It is computed
             * from previous sessions, so once the lifter has logged a set today it is
             * commenting on a session it cannot see — which is how "cut 10%" came to
             * be rendered directly beneath a personal-record badge earned two minutes
             * earlier. Once they are underway, the sets on screen are the better
             * guide and this is noise.
             */
            suggestion={
              exercise.sets.some((set) => set.state !== 'pending' && set.type !== 'warmup')
                ? null
                : suggestionLine(suggestionFor(exercise.exercise, history, loadStepKg))
            }
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
              dispatch({
                type: 'add_set',
                exerciseId: exercise.id,
                setType: kind,
                // A warmup goes above the working sets, which is where warmups happen.
                ...(kind === 'warmup' ? { atStart: true } : {}),
                now: now(),
              })
            }
            onRemoveExercise={removeExercise}
            onMoveExercise={(exerciseId, toIndex) =>
              dispatch({ type: 'move_exercise', exerciseId, toIndex })
            }
          />
        ))
      )}

      {/*
        Everything docked at the bottom, in one element, inside the scrolling main
        area — never fixed to the viewport, whose bottom edge belongs to the shell's
        tab bar (see `.ffw-dock`).

        The rest bar sits *above* the action bar rather than below it. Frequency would
        argue the other way, but the action bar is always present and the rest bar
        comes and goes: putting the intermittent one underneath would shift Finish up
        and down under the lifter's thumb every time a rest started or ended, and a
        moving target next to a session-ending button is a mis-tap waiting to happen.
        Stable beats marginally closer.
      */}
      <div className="ffw-dock">
        {timer.rest === null ? null : (
          <RestBar
            rest={timer.rest}
            now={timer.now}
            forLabel={restingExercise?.exercise.name ?? 'your last set'}
            onAdjust={timer.adjust}
            onSkip={() => timer.stop()}
          />
        )}

        <div className="ffw-actions">
          <Button
            size="xl"
            variant="secondary"
            disabled={!canAddExercise(state.workout)}
            onClick={() => setPickerOpen(true)}
          >
            <PlusGlyph aria-hidden="true" /> Exercise
          </Button>
          {logged ? (
            <Button size="xl" variant="primary" onClick={finish}>
              Finish
            </Button>
          ) : (
            /*
             * Finishing needs something to save, so with nothing logged the primary
             * action is to clear up instead. No confirmation: there is nothing to
             * lose, which is exactly the condition that put us in this branch.
             */
            <Button
              size="xl"
              variant="secondary"
              onClick={startNext}
              disabled={exercises.length === 0}
            >
              Clear session
            </Button>
          )}
        </div>
      </div>

      <ExercisePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={addExercise}
        catalogue={catalogue}
        recentIds={recentIds}
        recommendedIds={recommendedIds}
      />

      {/*
        * The app saved something on the lifter's behalf, so it says so.
        *
        * A stale session is filed and a fresh one started before the first paint (see
        * `resumeSession`). Silently is not an option — a session that was on screen
        * yesterday and is gone today is indistinguishable from data loss — and a modal
        * is not an option either (CLAUDE.md). A toast is neither: it does not block the
        * first tap, which is still the thing the ten-second budget is spent on.
        */}
      {recovered === null ? null : (
        <ToastRegion>
          <Toast tone="info" durationMs={8000} onDismiss={() => setRecovered(null)}>
            Saved “{recovered}” — it had been left running.
          </Toast>
        </ToastRegion>
      )}

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

/**
 * What to put on screen when the app opens: the session in progress, or a fresh one.
 *
 * ## The thirty-nine-hour session
 *
 * A user's header read **39:22:01**. Nothing capped the clock, nothing prompted a
 * finish, and reopening the app the next day resumed a session that had ended when
 * they left the gym — so the duration on every session they ever left open was wrong,
 * and the most-read number on the screen was absurd.
 *
 * A session is over when it has been idle longer than `SESSION_IDLE_MS`: four
 * hours with nothing logged means the lifter went home. Deliberately idle time rather
 * than total length or the calendar day, because a five-hour meet is real and a
 * session that starts at 23:30 is still one session at 00:15.
 *
 * On resume, a stale session is not resumed:
 *
 *   - **With work logged**, it is finished and filed. `endedAtFor` puts `endedAt` at
 *     the last logged set rather than at "now", so history records the session that
 *     actually happened instead of the gap since. Nothing is lost — a finished session
 *     in history is where it belongs — and the toast says so, because a write on the
 *     lifter's behalf that they are not told about is indistinguishable from data loss.
 *   - **With nothing logged**, it is dropped. There is nothing to save, which is
 *     exactly the condition that makes dropping it safe.
 *
 * Appending here rather than in an effect matters: `loadHistory()` is memoised during
 * the same render, just below, so the recovered session is available to ghost the new
 * one. Recovered yesterday's squats, and today's rows arrive pre-filled with them.
 */
export function resumeSession(
  repository: WorkoutRepository,
  at: number,
): { readonly state: WorkoutState; readonly recoveredTitle: string | null } {
  const active = repository.loadActive();
  if (active === null) return { state: startWorkout({ now: at }), recoveredTitle: null };

  if (!isStale(active, at)) return { state: { workout: active, undoStack: [] }, recoveredTitle: null };

  const fresh = startWorkout({
    now: at,
    ...(active.bodyweightKg === undefined ? {} : { bodyweightKg: active.bodyweightKg }),
  });

  if (!hasLoggedWork(active)) {
    // Nothing logged is not a workout, and writing one puts a phantom session into
    // the streak and the session count insights reads off the history.
    repository.saveActive(null);
    return { state: fresh, recoveredTitle: null };
  }

  // Keyed by id, so a repeated resume replaces rather than duplicates.
  repository.putSession(
    toCompletedSession(
      workoutReducer({ workout: active, undoStack: [] }, { type: 'finish', now: at }).workout,
    ),
  );
  repository.saveActive(null);
  // The rest that was running belongs to a session that is now over.
  repository.saveRest(null);

  return { state: fresh, recoveredTitle: active.title };
}

/**
 * The end of the clock's honest range.
 *
 * The header counts wall clock, and wall clock keeps going while the phone sits in a
 * locker. Once a session has been idle past the grace period it has stopped being
 * measured, so the clock stops with it rather than climbing towards the 39 hours a
 * user actually saw. Logging another set moves `lastActivityAt` and the clock picks up
 * again — which is the right behaviour, because that is a session that resumed.
 */
export function clockAt(workout: DraftWorkout, now: number): number {
  return workout.endedAt ?? endedAtFor(workout, now);
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
