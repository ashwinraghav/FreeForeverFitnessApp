import type { SetId, SetState, SortKey } from '@freeforever/data';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GhostValues } from '../model/ghosts.js';
import type { DraftSet } from '../model/types.js';
import { SetRow, type EditableField } from './SetRow.js';

// `test/setup.ts` does not enable vitest globals, so Testing Library cannot register
// its own auto-cleanup. Without this every render stacks up in the body and the
// second `getByRole` in a file finds two of everything.
afterEach(cleanup);

function draftSet(overrides: Partial<DraftSet> = {}): DraftSet {
  return {
    id: 's1' as SetId,
    sortKey: 'a' as SortKey,
    type: 'working',
    state: 'pending',
    loadKind: 'external',
    effortKind: 'reps',
    weightKg: null,
    reps: null,
    durationSec: null,
    distanceM: null,
    ...overrides,
  };
}

const GHOST: GhostValues = { weightKg: 100, reps: 5, durationSec: null, distanceM: null };

interface Harness {
  readonly set?: Partial<DraftSet>;
  readonly ghost?: GhostValues | undefined;
  readonly openField?: EditableField | null;
}

function setup(harness: Harness = {}) {
  const onChangeState = vi.fn<(state: SetState) => void>();
  const onEdit = vi.fn();
  const onOpenField = vi.fn();
  const onRemove = vi.fn();

  const view = render(
    <ul>
      <SetRow
        set={draftSet(harness.set)}
        index={1}
        ghost={'ghost' in harness ? harness.ghost : GHOST}
        lastTime="100x5"
        exerciseName="Bench Press"
        openField={harness.openField ?? null}
        onOpenField={onOpenField}
        onChangeState={onChangeState}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    </ul>,
  );

  /** The log button, found the way a screen reader finds it: by its role and name. */
  const logButton = (name: RegExp) =>
    within(view.container).getByRole('button', { name });

  const cells = () => [...view.container.querySelectorAll('.ffw-cell')];

  return { ...view, logButton, cells, onChangeState, onEdit, onOpenField, onRemove };
}

describe('the one-tap repeat set', () => {
  it('logs with a single tap on the log button', () => {
    const row = setup();
    fireEvent.click(row.logButton(/^Log as made/));
    expect(row.onChangeState).toHaveBeenCalledTimes(1);
    expect(row.onChangeState).toHaveBeenCalledWith('completed');
  });

  it('needs no interaction with the value cells first', () => {
    // The whole point: last session's 100x5 is already on the row.
    const row = setup();
    fireEvent.click(row.logButton(/^Log as made/));
    expect(row.onOpenField).not.toHaveBeenCalled();
    expect(row.onEdit).not.toHaveBeenCalled();
  });

  it('will not log a set with nothing to log', () => {
    // No entered value and no ghost would write an empty set — which is worse than
    // nothing, because it becomes next week's ghost.
    const row = setup({ ghost: undefined });
    expect(row.logButton(/^Log as made/)).toBeDisabled();
  });

  it('will log once the lifter has typed a rep count', () => {
    const row = setup({ ghost: undefined, set: { reps: 8 } });
    expect(row.logButton(/^Log as made/)).toBeEnabled();
  });
});

describe('three states, never a boolean', () => {
  it('walks pending, made, missed, and back', () => {
    const pending = setup();
    fireEvent.click(pending.logButton(/^Log as made/));
    expect(pending.onChangeState).toHaveBeenCalledWith('completed');

    const made = setup({ set: { state: 'completed', weightKg: 100, reps: 5 } });
    fireEvent.click(made.logButton(/^Mark as missed/));
    expect(made.onChangeState).toHaveBeenCalledWith('failed');

    const missed = setup({ set: { state: 'failed', weightKg: 100, reps: 3 } });
    fireEvent.click(missed.logButton(/^Clear/));
    expect(missed.onChangeState).toHaveBeenCalledWith('pending');
  });

  it('names the next action, not the current state', () => {
    // A button announced as "made" that marks a miss when tapped is a trap.
    const made = setup({ set: { state: 'completed', weightKg: 100, reps: 5 } });
    expect(made.logButton(/^Mark as missed/)).toBeInTheDocument();
    expect(made.queryByRole('button', { name: /^Log as made/ })).not.toBeInTheDocument();
  });

  it('carries the state in the row for a screen reader as well as in colour', () => {
    const made = setup({ set: { state: 'completed', weightKg: 100, reps: 5 } });
    expect(made.getByRole('listitem', { name: /made/ })).toBeInTheDocument();
  });

  it('pairs every state with a shape, not only a colour', () => {
    // Greyscale, a sun-washed screen, and any colour-vision deficiency all have to
    // leave "made" and "missed" distinguishable (ADR-0013).
    for (const state of ['pending', 'completed', 'failed'] as const) {
      const row = setup({ set: { state, weightKg: 100, reps: 5 } });
      expect(row.container.querySelector('.ffw-log svg')).not.toBeNull();
      row.unmount();
    }
  });
});

describe('a ghost is visibly not entered data', () => {
  it('marks the cell as a ghost in the DOM', () => {
    const row = setup();
    expect(row.cells().map((cell) => cell.getAttribute('data-ff-source'))).toEqual([
      'ghost',
      'ghost',
    ]);
  });

  it('says so to a screen reader too, which cannot see the dashed underline', () => {
    const row = setup();
    expect(
      row.getByRole('button', { name: /Weight: 100 kg, suggested from last time/ }),
    ).toBeInTheDocument();
  });

  it('stops being a ghost the moment a value is entered', () => {
    const row = setup({ set: { weightKg: 102.5 } });
    const cells = row.cells();
    expect(cells[0]).toHaveAttribute('data-ff-source', 'entered');
    expect(cells[0]).toHaveTextContent('102.5');
    // The untouched reps cell is still a ghost.
    expect(cells[1]).toHaveAttribute('data-ff-source', 'ghost');
  });

  it('shows an em dash rather than a zero when there is nothing at all', () => {
    const row = setup({ ghost: undefined });
    const cell = row.cells()[0];
    expect(cell).toHaveAttribute('data-ff-source', 'empty');
    expect(cell).toHaveTextContent('—');
    expect(cell).not.toHaveTextContent('0');
  });

  it('shows an entered zero as zero', () => {
    // Zero reps is a fact. `null` is the absence of one, and they must not look alike.
    const row = setup({ set: { reps: 0 }, ghost: undefined });
    const cells = row.cells();
    expect(cells[1]).toHaveAttribute('data-ff-source', 'entered');
    expect(cells[1]).toHaveTextContent('0');
  });
});

describe('the inline editor', () => {
  it('opens from the value cell rather than a modal', () => {
    const row = setup();
    fireEvent.click(row.getByRole('button', { name: /Weight:/ }));
    expect(row.onOpenField).toHaveBeenCalledWith('weight');
  });

  it('renders in the list, with no dialog and no scrim', () => {
    // No modals during a workout: a dismissed overlay that takes entered sets with it
    // is the worst failure mode in this category (CLAUDE.md).
    const row = setup({ openField: 'weight' });
    expect(row.container.querySelector('.ffw-editor')).not.toBeNull();
    expect(row.queryByRole('dialog')).not.toBeInTheDocument();
    expect(row.container.querySelector('[data-ff-scrim]')).toBeNull();
  });

  it('seeds the field with the ghost so a stepper tap moves from 100, not from 0', () => {
    const row = setup({ openField: 'weight' });
    const input = row.getByLabelText('Weight');
    expect(input).toHaveValue('100');
    expect(input).toHaveAttribute('data-ff-ghost', 'true');
  });

  it('opens the right editor for a timed hold', () => {
    const row = setup({
      openField: 'effort',
      set: { effortKind: 'duration', loadKind: 'none' },
      ghost: { weightKg: null, reps: null, durationSec: 60, distanceM: null },
    });
    expect(row.getByLabelText('Seconds')).toBeInTheDocument();
  });

  it('offers removal from inside the editor, not from the row', () => {
    // Removal is destructive, so it lives one level in — where a chalky thumb aiming
    // for the log button cannot reach it.
    const closed = setup();
    expect(closed.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();

    const open = setup({ openField: 'weight' });
    fireEvent.click(open.getByRole('button', { name: /^Remove/ }));
    expect(open.onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('the load column adapts to how the exercise is loaded', () => {
  it('calls assisted work assistance, not weight', () => {
    // Assisted work counts *down*: labelling it "weight" makes a lifter reading the
    // row think more is better.
    const row = setup({ openField: 'weight', set: { loadKind: 'assisted' } });
    expect(row.getByLabelText('Assistance')).toBeInTheDocument();
  });

  it('calls bodyweight loading added weight', () => {
    const row = setup({ openField: 'weight', set: { loadKind: 'bodyweight' } });
    expect(row.getByLabelText('Added weight')).toBeInTheDocument();
  });

  it('shows no load cell at all for an unloaded movement', () => {
    const row = setup({ set: { loadKind: 'none', effortKind: 'duration' } });
    expect(row.cells()).toHaveLength(1);
  });
});

describe('warmups', () => {
  it('are marked with a letter, not a number', () => {
    const row = setup({ set: { type: 'warmup' } });
    const marker = row.container.querySelector('.ffw-row__index');
    expect(marker).toHaveTextContent('W');
    expect(marker).toHaveAttribute('data-ff-warmup', 'true');
  });

  it('say so in the row label', () => {
    const row = setup({ set: { type: 'warmup' } });
    expect(row.getByRole('listitem', { name: /warmup/ })).toBeInTheDocument();
  });
});
