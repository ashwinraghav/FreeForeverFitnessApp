import { Button, CheckGlyph, CloseGlyph, NumberField, SegmentedControl } from '@freeforever/design-system';
import type { SetState } from '@freeforever/data';
import type { ReactNode } from 'react';
import { useId } from 'react';

import type { GhostValues } from '../model/ghosts.js';
import { cellFor, isLoggableInOneTap } from '../model/ghosts.js';
import { SET_STATE_OPTIONS, toggleSetLogged, type SetPatch } from '../model/session.js';
import type { DraftSet } from '../model/types.js';

/**
 * One row of the set table. The highest-leverage interaction in the product.
 *
 * ## The interaction model
 *
 * A row is five columns: the set number, what happened last time, the load, the
 * effort, and the log button. The load and effort columns are pre-filled with last
 * session's numbers as **ghosts** — visibly not entered data, but tappable as-is.
 *
 * So a repeat set is **one tap**: the log button. It commits whatever the row was
 * showing and marks the set made. Four digits of typing, forty times a session,
 * disappears.
 *
 * ## The log button says what it does
 *
 * It used to be a bare glyph that cycled `pending -> completed -> failed -> pending`.
 * The words for those transitions existed — they are still in {@link NEXT_ACTION} —
 * but only as an `aria-label`, so the one group never told what the control did was
 * the sighted one. A real user tapped it twice, landed on `failed`, and read the large
 * red cross as a delete button sitting where the primary action should be.
 *
 * Two changes, and they are the point of this component:
 *
 *   1. **The button carries a visible word** under its glyph — `LOG`, `MADE`,
 *      `MISSED`. Shape, colour and text, so it survives greyscale and bad light
 *      (ADR-0013) and so it can be read at all.
 *   2. **It toggles rather than cycles.** Tap to log, tap again to take it back.
 *      Missing a set is rare and making one is common; they must not be adjacent taps
 *      on one control. `failed` moved into the editor, where it is a labelled choice.
 *      From `failed` a tap still returns to untouched, so no state traps you.
 *
 * ## Changing a number, and marking a miss
 *
 * Tapping a value cell opens an editor **inline, in the list**. Not a sheet, not a
 * dialog, nothing that can be dismissed by a stray swipe with the entered set inside
 * it — no modals during a workout (CLAUDE.md). The editor uses `NumberField`, whose
 * steppers are 56px, because typing while holding a dumbbell is not realistic.
 *
 * The editor is also where a set is marked missed, and that is not a detour: a set you
 * missed almost always needs its rep count corrected too — you failed at seven of ten
 * — so the number and the outcome are one edit, in one place, both labelled.
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

/**
 * What the log button does next, now that it toggles rather than cycles.
 *
 * The name still describes the *action*, not the state: a button announced as "made"
 * that does something when tapped is a trap. The visible word beside it is the state,
 * which is the checkbox idiom and is what a lifter reading the log needs to see.
 */
const NEXT_ACTION: Record<SetState, string> = {
  pending: 'Log as made',
  completed: 'Undo, back to not logged',
  failed: 'Undo, back to not logged',
};

/** The word printed on the button. Four to six characters, so it fits the target. */
const STATE_WORD: Record<SetState, string> = {
  pending: 'Log',
  completed: 'Made',
  failed: 'Missed',
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
          // announced as "made" that un-logs when tapped is a trap. The visible word
          // below is the state, which is what the checkbox idiom leads a reader to
          // expect and what makes the log legible at a glance.
          aria-label={`${NEXT_ACTION[set.state]}: ${rowLabel}`}
          onClick={() => onChangeState(toggleSetLogged(set.state))}
        >
          <StateGlyph state={set.state} />
          <span className="ffw-log__word" aria-hidden="true">
            {STATE_WORD[set.state]}
          </span>
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

            {/*
              * How the set went, in words.
              *
              * This is where `missed` lives now. It used to be the second tap of an
              * unlabelled cycling glyph in the row, which is how a user came to read
              * a large red cross as "delete". Here it is one of three words, next to
              * the rep count the miss almost always needs changing anyway.
              *
              * Choosing a state closes the editor: the lifter came here to say what
              * happened, and saying it is the end of the errand.
              */}
            <SegmentedControl
              className="ffw-editor__state"
              label={`How ${rowLabel} went`}
              value={set.state}
              options={SET_STATE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              onValueChange={(value) => {
                onChangeState(value as SetState);
                onOpenField(null);
              }}
            />

            {/*
              * Two text buttons, not two icon squares.
              *
              * This row used to be a large filled-red ✗ and a ✓ — the loudest thing on
              * the screen was a destructive control, and neither said what it did, so
              * an open editor offered four unlabelled ways to act on one number.
              * `Remove set` is now quiet and spelled out; `Done` replaces a tick that
              * looked like the row's own log button.
              */}
            <div className="ffw-editor__quick">
              {/*
                * The accessible name starts with the visible text and then says which
                * row, so a screen-reader user is told what a sighted one can see from
                * the highlighted cell above. Starting with it is what keeps WCAG 2.5.3
                * happy — an `aria-label` that does not contain the visible label breaks
                * voice control, which speaks what is written on the button.
                */}
              <Button
                variant="ghost"
                size="xl"
                className="ffw-editor__remove"
                aria-label={`Remove set — ${rowLabel}`}
                onClick={onRemove}
              >
                Remove set
              </Button>
              <span className="ffw-editor__spacer" />
              <Button
                variant="secondary"
                size="xl"
                aria-label={`Done editing ${rowLabel}`}
                onClick={() => onOpenField(null)}
              >
                Done
              </Button>
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
