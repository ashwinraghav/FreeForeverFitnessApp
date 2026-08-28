import { Badge, Button, ChevronDownGlyph, IconButton, PlusGlyph } from '@freeforever/design-system';
import type { SetId, SetState, WorkoutExerciseId } from '@freeforever/data';
import { OLYMPIC_BAR_KG, METRIC_PLATE_STOCK } from '@freeforever/core';

import type { GhostMap } from '../model/ghosts.js';
import type { ExerciseHistoryEntry } from '../model/history.js';
import { orderedSets, type SetPatch } from '../model/session.js';
import type { DraftExercise, DraftSet } from '../model/types.js';
import { HistoryStrip, summariseSets } from './HistoryStrip.js';
import { PlateHint } from './PlateHint.js';
import { SetRow, type EditableField } from './SetRow.js';

/**
 * One exercise: its history, its sets, and the controls for changing either.
 *
 * Everything frequent is inside the row — the log button, the two value cells. The
 * card's own controls (add a set, add a warmup, move, remove) are below the sets, not
 * in a top-right corner: the top-right of a phone held in one hand is the hardest
 * point on the screen to reach and the easiest to hit by accident.
 */

/** Human names for the record types, short enough to fit a badge. */
const PR_LABEL: Record<string, string> = {
  heaviest_weight: 'Heaviest',
  best_e1rm: 'Best est. 1RM',
  most_reps: 'Most reps',
  best_set_volume: 'Best set',
  best_session_volume: 'Best session',
  best_duration: 'Longest hold',
  best_distance: 'Furthest',
};

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

  // A barbell lift gets a plate breakdown in its editor. Everything else does not:
  // there is nothing to solve for a cable stack or a fixed dumbbell.
  const barbellSetup =
    exercise.exercise.loadKind === 'external'
      ? { barKg: OLYMPIC_BAR_KG, plates: METRIC_PLATE_STOCK }
      : null;

  // Warmups and working sets are numbered in separate lanes, so the first working set
  // is "1" whether or not three warmups came before it — and so the "last" column
  // lines a warmup up against last session's warmup.
  let workingIndex = 0;
  let warmupIndex = 0;

  return (
    <section className="ffw-card" aria-label={exercise.exercise.name}>
      <header className="ffw-card__head">
        <h3 className="ffw-card__name">
          {exercise.exercise.name}
          <span className="ffw-card__meta">
            {lastTime === null ? 'First time' : `Last: ${summariseSets(lastTime.sets)}`}
          </span>
        </h3>
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

      {props.records.length === 0 ? null : (
        <div className="ffw-card__tools" aria-label={`${exercise.exercise.name} records`}>
          {props.records.map((type) => (
            <Badge key={type} tone="success">
              {PR_LABEL[type] ?? type} PR
            </Badge>
          ))}
        </div>
      )}

      {props.suggestion === null ? null : <p className="ffw-note">{props.suggestion}</p>}

      <HistoryStrip entries={history} today={today} />

      <div className="ffw-sets__legend" aria-hidden="true">
        <span>#</span>
        <span>Last</span>
        <span>{exercise.exercise.loadKind === 'none' ? '' : 'Weight'}</span>
        <span>{effortHeading(exercise)}</span>
        <span />
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
              editorExtra={
                open === 'weight' && barbellSetup !== null ? (
                  <PlateHint targetKg={set.weightKg} setup={barbellSetup} />
                ) : null
              }
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
        <Button
          size="lg"
          variant="ghost"
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
