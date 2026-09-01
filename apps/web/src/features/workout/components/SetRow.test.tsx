import type { SetId, SetState, SortKey } from '@freeforever/data';
import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { GhostValues } from '../model/ghosts.js';
import type { DraftSet } from '../model/types.js';
import { SetRow, type EditableField } from './SetRow.js';

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
  it('toggles between logged and not, so a stray tap cannot reach missed', () => {
    // The cycle this replaces was `pending -> completed -> failed`, on a control with
    // no visible label. A real user tapped it twice and landed on a large red cross
    // they read as delete, sitting where the primary action should be.
    const pending = setup();
    fireEvent.click(pending.logButton(/^Log as made/));
    expect(pending.onChangeState).toHaveBeenCalledWith('completed');

    const made = setup({ set: { state: 'completed', weightKg: 100, reps: 5 } });
    fireEvent.click(made.logButton(/^Undo/));
    expect(made.onChangeState).toHaveBeenCalledWith('pending');
  });

  it('lets a missed set out again in one tap, so no state is a trap', () => {
    const missed = setup({ set: { state: 'failed', weightKg: 100, reps: 3 } });
    fireEvent.click(missed.logButton(/^Undo/));
    expect(missed.onChangeState).toHaveBeenCalledWith('pending');
  });

  it('marks a set missed from the editor, in words', () => {
    // The whole point of the change: "missed" is a word a sighted user can read,
    // not the second tap of an unlabelled glyph.
    const open = setup({ openField: 'effort', set: { state: 'completed', reps: 7 } });
    fireEvent.click(open.getByRole('radio', { name: 'Missed' }));
    expect(open.onChangeState).toHaveBeenCalledWith('failed');
  });

  it('offers all three outcomes in the editor, and shows which one holds', () => {
    const open = setup({ openField: 'effort', set: { state: 'failed', reps: 7 } });
    for (const name of ['Made', 'Missed', 'Not yet']) {
      expect(open.getByRole('radio', { name })).toBeInTheDocument();
    }
    expect(open.getByRole('radio', { name: 'Missed' })).toHaveAttribute('aria-checked', 'true');
  });

  it('names the action for a screen reader, not the current state', () => {
    // A button announced as "made" that un-logs when tapped is a trap.
    const made = setup({ set: { state: 'completed', weightKg: 100, reps: 5 } });
    expect(made.logButton(/^Undo/)).toBeInTheDocument();
    expect(made.queryByRole('button', { name: /^Log as made/ })).not.toBeInTheDocument();
  });

  it('prints the state as a word, not only as a colour and a glyph', () => {
    // The control never said what it was for. The words existed — as `aria-label`s —
    // so the only people ever told were the ones who could not see it.
    const words: Record<string, string> = { pending: 'Log', completed: 'Made', failed: 'Missed' };
    for (const [state, word] of Object.entries(words)) {
      const row = setup({ set: { state: state as SetState, weightKg: 100, reps: 5 } });
      expect(row.container.querySelector('.ffw-log__word')).toHaveTextContent(word);
      row.unmount();
    }
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
    // for the log button cannot reach it. It is a quiet text button now rather than a
    // filled red square, which was the loudest thing on the whole screen.
    const closed = setup();
    expect(closed.queryByRole('button', { name: /^Remove set/ })).not.toBeInTheDocument();

    const open = setup({ openField: 'weight' });
    fireEvent.click(open.getByRole('button', { name: /^Remove set/ }));
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

describe('mid-set hit targets', () => {
  it('gives the editor controls the mid-set size, not the 48px floor', () => {
    // ADR-0013 asks for 56px for anything tapped mid-set, and the set editor is the
    // most tapped surface in the app. Remove and Close were `lg` (48px) while the
    // steppers beside them were already `xl`.
    const row = setup({ openField: 'weight' });
    for (const name of [/^Remove set/, /^Done editing/]) {
      expect(row.getByRole('button', { name })).toHaveAttribute('data-ff-size', 'xl');
    }
  });

  it('gives the editor state control the mid-set size too', () => {
    // `SegmentedControl` composes `.ff-control`, whose floor is the general 48px.
    // This one is tapped mid-set, so the feature stylesheet raises it — jsdom cannot
    // measure that, so this asserts the hook the rule is attached to.
    const row = setup({ openField: 'weight' });
    expect(row.container.querySelector('.ffw-editor__state')).not.toBeNull();
  });

  it('gives the log button the mid-set size too', () => {
    const row = setup();
    // The log button is not an IconButton, so its size is the CSS class contract.
    expect(row.logButton(/^Log as made/).className).toContain('ffw-log');
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

describe('rep chips, centred on last time', () => {
  /*
   * The editor used to open straight into the OS keyboard, which costs about
   * 400px — more than the rest bar and the action bar together. These chips
   * exist so the common answer is reachable without it, and they are centred on
   * the ghost because "same as last time, or one either side" is what
   * progression actually looks like.
   */
  const chips = (container: HTMLElement) =>
    [...container.querySelectorAll('.ffw-quick__chip')].map((c) => c.textContent?.trim());

  it('centres the chips on last session’s reps', () => {
    // GHOST.reps is 5, so 3..7 with 5 in the middle.
    const row = setup({ openField: 'effort' });
    expect(chips(row.container)).toEqual(['3', '4', '5', '6', '7']);
  });

  it('never offers a rep count below one', () => {
    const row = setup({ openField: 'effort', ghost: { weightKg: null, reps: 1, durationSec: null, distanceM: null } });
    // 1..3, not -1..3 — a set of zero reps is not a thing anyone means to log.
    expect(chips(row.container)).toEqual(['1', '2', '3']);
  });

  it('offers nothing at all when there is no history to centre on', () => {
    // Deliberate: with no ghost there is no "usual", and inventing a typical
    // number would teach a default the lifter never chose.
    const row = setup({ openField: 'effort', ghost: undefined });
    expect(chips(row.container)).toEqual([]);
  });

  it('marks the chip matching the current value, not the ghost', () => {
    const row = setup({ openField: 'effort', set: { reps: 6 } });
    const pressed = [...row.container.querySelectorAll('.ffw-quick__chip')]
      .filter((c) => c.getAttribute('aria-pressed') === 'true')
      .map((c) => c.textContent?.trim());
    expect(pressed).toEqual(['6']);
  });

  it('picking a chip sets the reps and closes the editor in one tap', () => {
    const row = setup({ openField: 'effort' });
    const seven = [...row.container.querySelectorAll('.ffw-quick__chip')].find(
      (c) => c.textContent?.trim() === '7',
    );
    fireEvent.click(seven as Element);
    expect(row.onEdit).toHaveBeenCalledWith({ reps: 7 });
    // Closing is the half that makes it one tap rather than two.
    expect(row.onOpenField).toHaveBeenCalledWith(null);
  });

  it('does not put focus in the text field, because that summons the keyboard', () => {
    setup({ openField: 'effort' });
    // The whole point of the change: focus follows the tap to a chip instead of
    // an input, so the OS keyboard stays down. If this ever becomes an INPUT
    // again the 400px problem is back.
    expect(document.activeElement?.tagName).not.toBe('INPUT');
  });

  it('still offers the field, so an unusual number is one tap away', () => {
    const row = setup({ openField: 'effort' });
    expect(row.container.querySelector('.ff-number')).not.toBeNull();
  });

  it('leaves the weight editor alone — chips are a reps idea', () => {
    const row = setup({ openField: 'weight' });
    expect(chips(row.container)).toEqual([]);
  });
});
