import { Badge, Button, ChevronDownGlyph, IconButton, PlusGlyph } from '@freeforever/design-system';
import type { SetId, SetState, WorkoutExerciseId } from '@freeforever/data';

import type { GhostMap } from '../model/ghosts.js';
import type { ExerciseHistoryEntry } from '../model/history.js';
import { orderedSets, type SetPatch } from '../model/session.js';
import type { DraftExercise, DraftSet } from '../model/types.js';
import { HistoryStrip, summariseSets } from './HistoryStrip.js';
import { SetRow, type EditableField } from './SetRow.js';

/**
 * One exercise: its history, its sets, and the controls for changing either.
 *
 * Everything frequent is inside the row — the log button, the two value cells. The
 * card's own controls (add a set, add a warmup, move, remove) are below the sets, not
 * in a top-right corner: the top-right of a phone held in one hand is the hardest
 * point on the screen to reach and the easiest to hit by accident.
 */

/**
 * Human names for the record types, short enough to fit a badge.
 *
 * Ordered most-worth-saying first, and **only the first one is shown**. One good set
 * against a stale history sets four records at once — heaviest, best estimated max,
 * best set volume and best session volume are all functions of the same lift — so
 * rendering them all produced four badges across two rows for a single tap. That is
 * noise where the brief asks for one number per glance, and a badge that appears four
 * at a time stops meaning anything.
 */
const PR_LABELS: readonly (readonly [string, string])[] = [
  ['heaviest_weight', 'Heaviest'],
  ['best_e1rm', 'Best est. 1RM'],
  ['most_reps', 'Most reps'],
  ['best_duration', 'Longest hold'],
  ['best_distance', 'Furthest'],
  ['best_set_volume', 'Best set'],
  ['best_session_volume', 'Best session'],
];

/** The single record worth putting on screen, or `null` when none were set. */
function headlineRecord(types: readonly string[]): string | null {
  if (types.length === 0) return null;
  const found = PR_LABELS.find(([type]) => types.includes(type));
  return found === undefined ? null : found[1];
}

export interface ExerciseCardProps {
  readonly exercise: DraftExercise;
  readonly position: number;
  readonly total: number;
  readonly ghosts: GhostMap;
  readonly history: readonly ExerciseHistoryEntry[];
  readonly today: string;
  /**
   * What the deterministic progression rules say to do next, already formatted, or
   * `null` when there is nothing useful to say. A hint that reads "hold" every week
   * trains the lifter to stop reading the line.
   */
  readonly suggestion: string | null;
  /** Record types this session's sets have beaten, most important first. */
  readonly records: readonly string[];
  readonly openEditor: { readonly setId: SetId; readonly field: EditableField } | null;
  readonly canAddSet: boolean;
  readonly loadStepKg: number;
  readonly onOpenEditor: (setId: SetId, field: EditableField | null) => void;
  readonly onChangeSetState: (setId: SetId, state: SetState) => void;
  readonly onEditSet: (setId: SetId, patch: SetPatch) => void;
  readonly onRemoveSet: (setId: SetId) => void;
  readonly onAddSet: (kind: 'working' | 'warmup') => void;
  readonly onRemoveExercise: (exerciseId: WorkoutExerciseId) => void;
  readonly onMoveExercise: (exerciseId: WorkoutExerciseId, toIndex: number) => void;
}

export function ExerciseCard(props: ExerciseCardProps) {
  const { exercise, ghosts, history, today, openEditor } = props;
  const sets = orderedSets(exercise);
  const lastTime = history[0] ?? null;

  const headline = headlineRecord(props.records);

  // Warmups and working sets are numbered in separate lanes, so the first working set
  // is "1" whether or not three warmups came before it — and so the "last" column
  // lines a warmup up against last session's warmup.
  let workingIndex = 0;
  let warmupIndex = 0;

  return (
    <section className="ffw-card" aria-label={exercise.exercise.name}>
      <header className="ffw-card__head">
        {/*
          * No "Last: ..." line under the name. It repeated the first row of the
          * history strip verbatim, and `text-transform: uppercase` turned it into
          * "LAST: 100X5 X2, 100X4✕" — where the rep multiplier, the set count and the
          * failure marker all render as the same glyph. The strip below says it once,
          * dated, in lower case.
          */}
        <h3 className="ffw-card__name">{exercise.exercise.name}</h3>
        <IconButton
          icon={<ChevronDownGlyph className="ffw-flip" />}
          aria-label={`Move ${exercise.exercise.name} up`}
          size="lg"
          disabled={props.position === 0}
          onClick={() => props.onMoveExercise(exercise.id, props.position - 1)}
        />
        <IconButton
          icon={<ChevronDownGlyph />}
          aria-label={`Move ${exercise.exercise.name} down`}
          size="lg"
          disabled={props.position >= props.total - 1}
          onClick={() => props.onMoveExercise(exercise.id, props.position + 1)}
        />
      </header>

      {headline === null ? null : (
        <p className="ffw-card__pr">
          <Badge tone="success">{headline} PR</Badge>
          {props.records.length > 1 ? (
            <span className="ffw-card__pr-more">
              +{props.records.length - 1} more
            </span>
          ) : null}
        </p>
      )}

      {props.suggestion === null ? null : <p className="ffw-note">{props.suggestion}</p>}

      <HistoryStrip entries={history} today={today} />

      {/*
        * The legend, on the same grid as the rows and aligned the way each column's
        * content is aligned.
        *
        * It was not. Every header was start-aligned while the value cells centre their
        * numbers, so "REPS" sat visibly left of the inputs it named and the whole
        * header row read as slightly broken — which is exactly how a user described
        * it. The alignment now comes from the same `--ffw-cols` track list the rows
        * use, with `.ffw-sets__legend > span` matched to its column.
        *
        * The state column is labelled too. It was the one column with a control in it
        * and no heading, which is part of why the control was hard to interpret.
        */}
      <div className="ffw-sets__legend" aria-hidden="true">
        <span>#</span>
        <span>Last</span>
        <span>{exercise.exercise.loadKind === 'none' ? '' : 'Weight'}</span>
        <span>{effortHeading(exercise)}</span>
        <span>Done</span>
      </div>

      <ul className="ffw-sets" aria-label={`${exercise.exercise.name} sets`}>
        {sets.map((set) => {
          if (set.type === 'warmup') warmupIndex += 1;
          else workingIndex += 1;
          const laneIndex = set.type === 'warmup' ? warmupIndex : workingIndex;
          const open = openEditor?.setId === set.id ? openEditor.field : null;
          return (
            <SetRow
              key={set.id}
              set={set}
              index={workingIndex}
              ghost={ghosts.get(set.id)}
              lastTime={lastSetLabel(lastTime, set, laneIndex)}
              exerciseName={exercise.exercise.name}
              openField={open}
              loadStepKg={props.loadStepKg}
              onOpenField={(field) => props.onOpenEditor(set.id, field)}
              onChangeState={(state) => props.onChangeSetState(set.id, state)}
              onEdit={(patch) => props.onEditSet(set.id, patch)}
              onRemove={() => props.onRemoveSet(set.id)}
            />
          );
        })}
      </ul>

      <div className="ffw-card__tools">
        <Button
          size="xl"
          variant="secondary"
          onClick={() => props.onAddSet('working')}
          disabled={!props.canAddSet}
        >
          <PlusGlyph aria-hidden="true" /> Set
        </Button>
        <Button
          size="lg"
          variant="ghost"
          onClick={() => props.onAddSet('warmup')}
          disabled={!props.canAddSet}
        >
          Warmup
        </Button>
        {/*
          * Outlined danger, which is neither of the two things this has been.
          *
          * As `ghost` it sat next to "Warmup" looking identical to it, one thumb-width
          * from the controls a lifter uses between sets. As filled `danger` it became
          * the loudest thing on a screen a user had just called noisy — a solid red
          * slab under every exercise, drawing the eye away from the numbers.
          *
          * The outline keeps it distinguishable from both neighbours by *shape* as
          * well as colour — "Set" has a neutral border, "Warmup" has none, this has a
          * danger-coloured one — so the distinction survives greyscale (ADR-0013)
          * without a block of red per exercise. Removal is still undoable from a toast.
          */}
        <Button
          size="lg"
          variant="ghost"
          className="ffw-card__remove"
          onClick={() => props.onRemoveExercise(exercise.id)}
        >
          Remove
        </Button>
      </div>
    </section>
  );
}

function effortHeading(exercise: DraftExercise): string {
  if (exercise.exercise.effortKind === 'duration') return 'Time';
  if (exercise.exercise.effortKind === 'distance') return 'Distance';
  return 'Reps';
}

/**
 * The "last" column: what the corresponding set was last time, as one short string.
 *
 * Positional, like the ghost it mirrors — the third row shows the third set of last
 * session, so a top-set-and-backoffs day reads correctly instead of repeating the top
 * set down the column.
 */
function lastSetLabel(
  entry: ExerciseHistoryEntry | null,
  set: DraftSet,
  laneIndex: number,
): string | null {
  if (entry === null) return null;
  const lane = set.type === 'warmup' ? entry.warmupSets : entry.sets;
  const source = lane[laneIndex - 1] ?? lane[lane.length - 1];
  if (source === undefined) return null;
  return summariseSets([source]);
}
