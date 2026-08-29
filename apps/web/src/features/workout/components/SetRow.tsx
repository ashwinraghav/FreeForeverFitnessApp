import { CheckGlyph, CloseGlyph, IconButton, NumberField } from '@freeforever/design-system';
import type { SetState } from '@freeforever/data';
import type { ReactNode } from 'react';
import { useId } from 'react';

import type { GhostValues } from '../model/ghosts.js';
import { cellFor, isLoggableInOneTap } from '../model/ghosts.js';
import { nextSetState, type SetPatch } from '../model/session.js';
import type { DraftSet } from '../model/types.js';

/**
 * One row of the set table. The highest-leverage interaction in the product.
 *
 * ## The interaction model
 *
 * A row is five columns: the set number, what happened last time, the load, the
 * effort, and a 56px log button. The load and effort columns are pre-filled with last
 * session's numbers as **ghosts** — visibly not entered data, but tappable as-is.
 *
 * So a repeat set is **one tap**: the log button. It commits whatever the row was
 * showing and marks the set made. Four digits of typing, forty times a session,
 * disappears.
 *
 * The button walks three states rather than toggling a boolean, because a training log
 * needs to say three things: untouched, made, and missed. `pending -> completed ->
 * failed -> pending`. Made is one tap. Missed is two. Undoing a mis-tap is three, and
 * it keeps every number — only the fact that the set was attempted is forgotten.
 *
 * ## Changing a number
 *
 * Tapping a value cell opens an editor **inline, in the list**. Not a sheet, not a
 * dialog, nothing that can be dismissed by a stray swipe with the entered set inside
 * it — no modals during a workout (CLAUDE.md). The editor uses `NumberField`, whose
 * steppers are 56px, because typing while holding a dumbbell is not realistic.
 *
 * ## What a ghost is not
 *
 * A ghost is never data. It arrives as a prop derived from history, `DraftSet` has no
 * field for it, and it becomes real only when the lifter taps the button. Visually it
 * is muted, lighter *and* dashed-underlined — three signals, so the difference
 * survives bad light, greyscale and any colour-vision deficiency (ADR-0013).
 */

export type EditableField = 'weight' | 'effort';

export interface SetRowProps {
  readonly set: DraftSet;
  /** 1-based position among this exercise's sets, for the leading column. */
  readonly index: number;
  readonly ghost: GhostValues | undefined;
  /** What this set was last time, already formatted. One glance, one line. */
  readonly lastTime: string | null;
  readonly exerciseName: string;
  /** Which field's inline editor is open, if any. */
  readonly openField: EditableField | null;
  readonly onOpenField: (field: EditableField | null) => void;
  readonly onChangeState: (state: SetState) => void;
  readonly onEdit: (patch: SetPatch) => void;
  readonly onRemove: () => void;
  /** Load step for the weight field, from the lifter's gym. Canonical kg. */
  readonly loadStepKg?: number;
  /** Rendered under the editor — the plate breakdown, when there is one. */
  readonly editorExtra?: ReactNode;
}

export const STATE_LABEL: Record<SetState, string> = {
  pending: 'not logged',
  completed: 'made',
  failed: 'missed',
};

const NEXT_ACTION: Record<SetState, string> = {
  pending: 'Log as made',
  completed: 'Mark as missed',
  failed: 'Clear',
};

export function SetRow({
  set,
  index,
  ghost,
  lastTime,
  exerciseName,
  openField,
  onOpenField,
  onChangeState,
  onEdit,
  onRemove,
  loadStepKg = 2.5,
  editorExtra,
}: SetRowProps) {
  const rowId = useId();
  const isWarmup = set.type === 'warmup';
  const loadCell = cellFor(set.weightKg, ghost?.weightKg);
  const effortCell = effortCellFor(set, ghost);
  const loggable = isLoggableInOneTap(set, ghost) || set.state !== 'pending';

  // A number every lifter can read at arm's length: the position among sets, or a
  // letter for a warmup. A shape, not just a weight, so it survives greyscale.
  const marker = isWarmup ? 'W' : String(index);

  const rowLabel = `${exerciseName}, ${isWarmup ? 'warmup' : `set ${index}`}`;

  return (
    <>
      <li className="ffw-row" data-ff-state={set.state} aria-label={`${rowLabel}, ${STATE_LABEL[set.state]}`}>
        <span className="ffw-row__index" data-ff-warmup={isWarmup ? 'true' : 'false'} aria-hidden="true">
          {marker}
        </span>

        <span className="ffw-row__last" title={lastTime ?? undefined}>
          {lastTime ?? '—'}
        </span>

        {set.loadKind === 'none' ? (
          <span className="ffw-row__last" aria-hidden="true" />
        ) : (
          <ValueCell
            id={`${rowId}-load`}
            label={`${rowLabel}, ${loadFieldName(set)}`}
            value={loadCell.value}
            source={loadCell.source}
            unit="kg"
            open={openField === 'weight'}
            onOpen={() => onOpenField(openField === 'weight' ? null : 'weight')}
          />
        )}

        <ValueCell
          id={`${rowId}-effort`}
          label={`${rowLabel}, ${effortFieldName(set)}`}
          value={effortCell.value}
          source={effortCell.source}
          unit={effortUnit(set)}
          open={openField === 'effort'}
          onOpen={() => onOpenField(openField === 'effort' ? null : 'effort')}
        />

        <button
          type="button"
          className="ffw-log ff-focusable"
          data-ff-state={set.state}
          disabled={!loggable}
          // The name says what happens next, not what the state is now — a button
          // announced as "made" when tapping it marks a miss is a trap.
          aria-label={`${NEXT_ACTION[set.state]}: ${rowLabel}`}
          onClick={() => onChangeState(nextSetState(set.state))}
        >
          <StateGlyph state={set.state} />
        </button>
      </li>

      {openField !== null ? (
        <li>
          <div className="ffw-editor" aria-label={`Edit ${rowLabel}`}>
            {openField === 'weight' ? (
              <NumberField
                label={loadFieldName(set)}
                unit="kg"
                step={loadStepKg}
                min={0}
                value={set.weightKg}
                ghostValue={ghost?.weightKg ?? null}
                onValueChange={(value) => onEdit({ weightKg: value })}
                autoFocus
              />
            ) : (
              <EffortField set={set} ghost={ghost} onEdit={onEdit} />
            )}

            {editorExtra}

            <div className="ffw-editor__quick">
              {/*
                * `xl`, not `lg`. These sit inside the set editor, which is the most
                * tapped surface in the app and is tapped mid-set — 56px, not the 48px
                * floor (ADR-0013). They were the only controls in the editor below
                * the mid-set size, next to steppers that were already 56.
                */}
              <IconButton
                icon={<CloseGlyph />}
                aria-label={`Remove ${rowLabel}`}
                variant="danger"
                size="xl"
                onClick={onRemove}
              />
              <span className="ffw-editor__spacer" />
              <IconButton
                icon={<CheckGlyph />}
                aria-label={`Close editor for ${rowLabel}`}
                variant="secondary"
                size="xl"
                onClick={() => onOpenField(null)}
              />
            </div>
          </div>
        </li>
      ) : null}
    </>
  );
}

interface ValueCellProps {
  readonly id: string;
  readonly label: string;
  readonly value: number | null;
  readonly source: 'entered' | 'ghost' | 'empty';
  readonly unit: string;
  readonly open: boolean;
  readonly onOpen: () => void;
}

function ValueCell({ id, label, value, source, unit, open, onOpen }: ValueCellProps) {
  const shown = value === null ? '—' : formatNumber(value);
  return (
    <button
      type="button"
      id={id}
      className="ffw-cell ff-focusable"
      data-ff-source={source}
      data-ff-open={open ? 'true' : 'false'}
      aria-expanded={open}
      // Screen readers get told a ghost is a suggestion; sighted users get the muted,
      // lighter, dashed treatment. Same information, two channels.
      aria-label={`${label}: ${value === null ? 'not set' : `${shown} ${unit}`}${
        source === 'ghost' ? ', suggested from last time' : ''
      }`}
      onClick={onOpen}
    >
      <span className="ffw-cell__number">{shown}</span>
      <span className="ffw-cell__unit" aria-hidden="true">
        {unit}
      </span>
    </button>
  );
}

function EffortField({
  set,
  ghost,
  onEdit,
}: {
  readonly set: DraftSet;
  readonly ghost: GhostValues | undefined;
  readonly onEdit: SetRowProps['onEdit'];
}) {
  if (set.effortKind === 'duration') {
    return (
      <NumberField
        label="Seconds"
        unit="s"
        step={5}
        min={0}
        value={set.durationSec}
        ghostValue={ghost?.durationSec ?? null}
        onValueChange={(value) => onEdit({ durationSec: value })}
        autoFocus
      />
    );
  }

  if (set.effortKind === 'distance') {
    return (
      <NumberField
        label="Metres"
        unit="m"
        step={100}
        min={0}
        value={set.distanceM}
        ghostValue={ghost?.distanceM ?? null}
        onValueChange={(value) => onEdit({ distanceM: value })}
        autoFocus
      />
    );
  }

  return (
    <NumberField
      label="Reps"
      unit="reps"
      step={1}
      min={0}
      value={set.reps}
      ghostValue={ghost?.reps ?? null}
      onValueChange={(value) => onEdit({ reps: value })}
      autoFocus
    />
  );
}

/**
 * The state glyph. A tick, a cross, or an empty ring.
 *
 * Every state has a *shape* as well as a colour, so a made set and a missed set stay
 * distinguishable in greyscale, on a sun-washed screen, and with any colour-vision
 * deficiency (ADR-0013).
 */
function StateGlyph({ state }: { readonly state: SetState }) {
  if (state === 'completed') return <CheckGlyph aria-hidden="true" />;
  if (state === 'failed') return <CloseGlyph aria-hidden="true" />;
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
    </svg>
  );
}

function effortCellFor(set: DraftSet, ghost: GhostValues | undefined) {
  if (set.effortKind === 'duration') return cellFor(set.durationSec, ghost?.durationSec);
  if (set.effortKind === 'distance') return cellFor(set.distanceM, ghost?.distanceM);
  return cellFor(set.reps, ghost?.reps);
}

function effortUnit(set: DraftSet): string {
  if (set.effortKind === 'duration') return 's';
  if (set.effortKind === 'distance') return 'm';
  return 'reps';
}

function effortFieldName(set: DraftSet): string {
  if (set.effortKind === 'duration') return 'seconds';
  if (set.effortKind === 'distance') return 'metres';
  return 'reps';
}

function loadFieldName(set: DraftSet): string {
  // Assisted work counts *down*, so calling the field "weight" would make a lifter
  // reading the row think more is better. It is not.
  if (set.loadKind === 'assisted') return 'Assistance';
  if (set.loadKind === 'bodyweight') return 'Added weight';
  return 'Weight';
}

/** `100`, `102.5`, never `102.50` and never `1.0000000001`. */
export function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
