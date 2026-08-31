import { Button, ChevronDownGlyph } from '@freeforever/design-system';
import type { SetId, SetState, WorkoutExerciseId } from '@freeforever/data';
import { hardSetCount, sessionTotals } from '@freeforever/core';
import { useMemo } from 'react';

import type { CompletedSession } from '../model/history.js';
import { toPerformedSet } from '../model/history.js';
import { wasEdited } from '../model/pastSession.js';
import { orderedSets, type SetPatch } from '../model/session.js';
import type { DraftExercise, DraftSet } from '../model/types.js';
import { relativeDay } from './HistoryStrip.js';
import { formatNumber, SetRow, type EditableField } from './SetRow.js';

/**
 * One finished session in the history list: a summary row, expandable, editable.
 *
 * ## Why this is not `ExerciseCard`
 *
 * It reuses `SetRow` and deliberately nothing above it. `ExerciseCard` carries ghosts, a
 * personal-record badge, a progression suggestion, a three-outing history strip and
 * add/move/remove tools — every one of which is either meaningless or actively wrong on
 * a session that is already over. Ghosts in particular: a ghost is a carried-over
 * suggestion for a set that has not happened yet, and offering one for a set performed
 * three weeks ago would invite the lifter to overwrite what they actually did with what
 * the app guessed.
 *
 * `SetRow` itself is exactly right, though, and reusing it is the point: the same
 * one-tap log semantics, the same labelled Made / Missed / Not yet, the same 56px
 * targets, already tested. Editing history should not feel like a different product from
 * logging it.
 *
 * ## Why this screen is allowed to be less austere than the live one
 *
 * The live screen is built for one chalky hand, bad light and a 90-second interruption
 * clock. Reviewing history is a sofa activity: two hands, no rush, nothing to lose to a
 * mis-tap. So dates, a disclosure, prose and a confirmation dialog are all fine here,
 * where none of them would be mid-set. The hit sizes are the part that is not
 * situational, and they stay.
 */

export interface PastSessionCardProps {
  readonly session: CompletedSession;
  readonly today: string;
  readonly expanded: boolean;
  readonly editing: boolean;
  readonly openEditor: { readonly setId: SetId; readonly field: EditableField } | null;
  readonly onToggleExpanded: () => void;
  readonly onStartEditing: () => void;
  readonly onStopEditing: () => void;
  readonly onOpenEditor: (setId: SetId, field: EditableField | null) => void;
  readonly onChangeSetState: (
    exerciseId: WorkoutExerciseId,
    setId: SetId,
    state: SetState,
  ) => void;
  readonly onEditSet: (
    exerciseId: WorkoutExerciseId,
    setId: SetId,
    patch: SetPatch,
  ) => void;
  readonly onRemoveSet: (exerciseId: WorkoutExerciseId, setId: SetId) => void;
  readonly onAddSetAfter: (exerciseId: WorkoutExerciseId, setId: SetId) => void;
  readonly onDiscard: () => void;
  readonly loadStepKg: number;
}

export function PastSessionCard(props: PastSessionCardProps) {
  const { session, expanded, editing } = props;

  const totals = useMemo(
    () =>
      sessionTotals(
        session.exercises.map((exercise) => ({
          exercise: exercise.exercise,
          sets: exercise.sets.map(toPerformedSet),
        })),
        session.bodyweightKg === undefined ? {} : { bodyweightKg: session.bodyweightKg },
      ),
    [session],
  );

  /*
   * The same honest count as the live header, for the same reason: `hardSetCount` is the
   * population `volumeKg` is summed over, so "0 sets · 300 kg" cannot happen here
   * either. A history list that contradicts itself is worse than the live screen doing
   * it, because this is the screen someone opens specifically to check a number.
   */
  const loggedSets = useMemo(
    () => hardSetCount(session.exercises.flatMap((exercise) => exercise.sets.map(toPerformedSet))),
    [session],
  );

  const durationSec = Math.max(
    0,
    Math.round(((session.endedAt ?? session.startedAt) - session.startedAt) / 1000),
  );

  const dateLabel = relativeDay(session.localDate, props.today);
  const summaryId = `${session.id}-detail`;

  return (
    <li className="ffw-past" data-ff-editing={editing ? 'true' : 'false'}>
      {/*
        The whole summary is the disclosure control, not a chevron beside it. A row this
        tall with a small hit area at one end is the pattern that makes people tap three
        times; the chevron stays as the affordance and rotates, but the target is the row.
      */}
      <button
        type="button"
        className="ffw-past__summary ff-focusable"
        aria-expanded={expanded}
        aria-controls={summaryId}
        onClick={props.onToggleExpanded}
      >
        <span className="ffw-past__when">
          <span className="ffw-past__date">{dateLabel}</span>
          <span className="ffw-past__full">{longDate(session.localDate)}</span>
        </span>

        <span className="ffw-past__figures">
          <Figure value={String(loggedSets)} label="sets" />
          <Figure
            value={totals.volumeKg > 0 ? formatNumber(Math.round(totals.volumeKg)) : '—'}
            label="kg"
          />
          <Figure value={formatDuration(durationSec)} label="time" />
        </span>

        {/*
          Quiet, and a caption rather than a warning. Editing your own log is legitimate;
          the reason it is shown at all is that personal records are derived from history,
          so a correction silently rewrites an all-time number. See `CompletedSession`.
        */}
        {wasEdited(session) ? <span className="ffw-past__edited">edited</span> : null}

        <ChevronDownGlyph
          className={expanded ? 'ffw-past__chevron ffw-flip' : 'ffw-past__chevron'}
          aria-hidden="true"
        />
      </button>

      {expanded ? (
        <div className="ffw-past__detail" id={summaryId}>
          {session.exercises.length === 0 ? (
            <p className="ffw-past__empty">Every set in this session has been removed.</p>
          ) : (
            session.exercises.map((exercise) => (
              <PastExercise
                key={exercise.id}
                exercise={exercise}
                editing={editing}
                openEditor={props.openEditor}
                loadStepKg={props.loadStepKg}
                onOpenEditor={props.onOpenEditor}
                onChangeSetState={props.onChangeSetState}
                onEditSet={props.onEditSet}
                onRemoveSet={props.onRemoveSet}
                onAddSetAfter={props.onAddSetAfter}
              />
            ))
          )}

          <div className="ffw-past__tools">
            {editing ? (
              <Button size="lg" variant="primary" onClick={props.onStopEditing}>
                Done editing
              </Button>
            ) : (
              <Button size="lg" variant="secondary" onClick={props.onStartEditing}>
                Edit session
              </Button>
            )}
            <span className="ffw-past__spacer" />
            <Button
              size="lg"
              variant="ghost"
              className="ffw-past__delete"
              onClick={props.onDiscard}
            >
              Delete session
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

interface PastExerciseProps {
  readonly exercise: DraftExercise;
  readonly editing: boolean;
  readonly openEditor: PastSessionCardProps['openEditor'];
  readonly loadStepKg: number;
  readonly onOpenEditor: PastSessionCardProps['onOpenEditor'];
  readonly onChangeSetState: PastSessionCardProps['onChangeSetState'];
  readonly onEditSet: PastSessionCardProps['onEditSet'];
  readonly onRemoveSet: PastSessionCardProps['onRemoveSet'];
  readonly onAddSetAfter: PastSessionCardProps['onAddSetAfter'];
}

function PastExercise({ exercise, editing, ...props }: PastExerciseProps) {
  const sets = orderedSets(exercise);
  let workingIndex = 0;

  return (
    <section className="ffw-card ffw-past__exercise" aria-label={exercise.exercise.name}>
      <h4 className="ffw-past__name">{exercise.exercise.name}</h4>

      {editing ? (
        <div className="ffw-sets__legend" aria-hidden="true">
          <span>#</span>
          <span>Last</span>
          <span>{exercise.exercise.loadKind === 'none' ? '' : 'Weight'}</span>
          <span>{effortHeading(exercise)}</span>
          <span>Done</span>
        </div>
      ) : null}

      <ul className="ffw-sets" aria-label={`${exercise.exercise.name} sets`}>
        {sets.map((set) => {
          if (set.type !== 'warmup') workingIndex += 1;
          if (!editing) {
            return (
              <PastSetLine
                key={set.id}
                index={workingIndex}
                set={set}
                name={exercise.exercise.name}
              />
            );
          }
          return (
            <SetRow
              key={set.id}
              set={set}
              index={workingIndex}
              /*
               * No ghost, ever. A ghost is a suggestion for a set that has not happened;
               * offering one here would invite the lifter to overwrite what they did with
               * what the app guessed. `undefined` also disables the one-tap commit path,
               * which is exactly right — there is nothing to commit.
               */
              ghost={undefined}
              lastTime={null}
              exerciseName={exercise.exercise.name}
              openField={props.openEditor?.setId === set.id ? props.openEditor.field : null}
              loadStepKg={props.loadStepKg}
              onOpenField={(field) => props.onOpenEditor(set.id, field)}
              onChangeState={(state) => props.onChangeSetState(exercise.id, set.id, state)}
              onEdit={(patch) => props.onEditSet(exercise.id, set.id, patch)}
              onRemove={() => props.onRemoveSet(exercise.id, set.id)}
            />
          );
        })}
      </ul>

      {editing ? (
        <div className="ffw-past__addset">
          <Button
            size="lg"
            variant="ghost"
            disabled={sets.length === 0}
            onClick={() => {
              const last = sets[sets.length - 1];
              if (last !== undefined) props.onAddSetAfter(exercise.id, last.id);
            }}
          >
            {/* Short on purpose. "Add a set you forgot" measured 406px at 200% text —
                `.ff-button` is `white-space: nowrap`, so it could neither wrap nor
                shrink and hung 58px off the edge. The context makes the shorter label
                unambiguous: it sits inside one exercise, in edit mode, under its sets. */}
            Add a set
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * A logged set, read-only: one line, no controls.
 *
 * Reading is the common case and it should not look like a form. The editable version is
 * a `SetRow` one tap away, and the two deliberately share their vocabulary — the same
 * words for the same three states — so switching into edit mode moves nothing the eye
 * was already tracking.
 */
function PastSetLine({
  index,
  set,
  name,
}: {
  readonly index: number;
  readonly set: DraftSet;
  readonly name: string;
}) {
  const isWarmup = set.type === 'warmup';
  return (
    <li
      className="ffw-pastset"
      data-ff-state={set.state}
      aria-label={`${name}, ${isWarmup ? 'warmup' : `set ${index}`}, ${describe(set)}, ${
        STATE_WORD[set.state]
      }`}
    >
      <span className="ffw-pastset__index" aria-hidden="true">
        {isWarmup ? 'W' : index}
      </span>
      <span className="ffw-pastset__value" aria-hidden="true">
        {describe(set)}
      </span>
      {/* A word, not only a colour and not only a glyph — the same three signals the
          live row carries, for the same reason (ADR-0013). */}
      <span className="ffw-pastset__state" aria-hidden="true">
        {STATE_WORD[set.state]}
      </span>
    </li>
  );
}

const STATE_WORD: Record<SetState, string> = {
  pending: 'not logged',
  completed: 'made',
  failed: 'missed',
};

/** `100 kg x 5`, `60s`, `BW x 12`. One line, the way a lifter would say it. */
function describe(set: DraftSet): string {
  const effort =
    set.effortKind === 'duration'
      ? `${set.durationSec ?? 0}s`
      : set.effortKind === 'distance'
        ? `${set.distanceM ?? 0} m`
        : `${set.reps ?? 0} reps`;

  if (set.loadKind === 'none' || set.weightKg === null) return effort;
  if (set.loadKind === 'assisted') return `−${formatNumber(set.weightKg)} kg · ${effort}`;
  if (set.loadKind === 'bodyweight') {
    return set.weightKg === 0
      ? `BW · ${effort}`
      : `BW +${formatNumber(set.weightKg)} kg · ${effort}`;
  }
  return `${formatNumber(set.weightKg)} kg · ${effort}`;
}

function Figure({ value, label }: { readonly value: string; readonly label: string }) {
  return (
    <span className="ffw-past__figure">
      <span className="ffw-past__figure-value">{value}</span>{' '}
      <span className="ffw-past__figure-label">{label}</span>
    </span>
  );
}

function effortHeading(exercise: DraftExercise): string {
  if (exercise.exercise.effortKind === 'duration') return 'Time';
  if (exercise.exercise.effortKind === 'distance') return 'Distance';
  return 'Reps';
}

/** "Sat 30 Aug". The weekday earns its place: people remember days, not dates. */
export function longDate(localDate: string): string {
  const parsed = new Date(`${localDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return localDate;
  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** `48m`, `1h 12m`. A session length, not a stopwatch. */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
