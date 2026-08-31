import type { SetId, SetState, SortKey } from '@freeforever/data';
import type { ReactNode } from 'react';

import type { GhostValues } from '../model/ghosts.js';
import type { DraftSet } from '../model/types.js';
import { SetRow } from '../components/SetRow.js';
import type { Meta, StoryObj } from './csf.js';
import '../workout.css';

type Props = Parameters<typeof SetRow>[0];

/**
 * One row of the set table — the control a lifter touches forty times a session.
 *
 * The three states belong in one frame, which is the reason this story exists. The log
 * button used to be a bare glyph: a tick, a cross, or a dashed ring, cycling `pending
 * -> completed -> failed -> pending` with the words only in an `aria-label`. A real
 * user tapped it twice, landed on a large red cross where the primary action should be,
 * and read it as delete. Seeing the three side by side is what makes that obvious; one
 * at a time, on a seeded device, it is not.
 *
 * What to check here:
 *
 *   - every state carries a **shape, a colour and a word**, so it survives greyscale,
 *     bad light and any colour-vision deficiency (ADR-0013) — flip the theme and the
 *     greyscale filter and all three stay distinguishable;
 *   - **missed is outlined, not filled** — it is a fact about training, not a
 *     destructive action, and it must not be the loudest thing on the screen;
 *   - the editor offers the outcome in **words**, next to the rep count a missed set
 *     almost always needs correcting anyway.
 */
const meta: Meta<Props> = {
  title: 'Workout/SetRow',
  component: SetRow,
};
export default meta;

const GHOST: GhostValues = { weightKg: 100, reps: 5, durationSec: null, distanceM: null };

function draftSet(state: SetState, overrides: Partial<DraftSet> = {}): DraftSet {
  return {
    id: `set-${state}` as SetId,
    sortKey: 'a' as SortKey,
    type: 'working',
    state,
    loadKind: 'external',
    effortKind: 'reps',
    weightKg: null,
    reps: null,
    durationSec: null,
    distanceM: null,
    ...overrides,
  };
}

function Row({
  set,
  index,
  openField = null,
}: {
  readonly set: DraftSet;
  readonly index: number;
  readonly openField?: Props['openField'];
}) {
  return (
    <SetRow
      set={set}
      index={index}
      ghost={GHOST}
      lastTime="100x5"
      exerciseName="Bench Press"
      openField={openField}
      onOpenField={() => undefined}
      onChangeState={() => undefined}
      onEdit={() => undefined}
      onRemove={() => undefined}
    />
  );
}

/** A whole card's worth of rows, so the grid columns can be read against each other. */
function Card({ children }: { readonly children: ReactNode }) {
  return (
    <section className="ffw-card">
      <div className="ffw-sets__legend" aria-hidden="true">
        <span>#</span>
        <span>Last</span>
        <span>Weight</span>
        <span>Reps</span>
        <span>Done</span>
      </div>
      <ul className="ffw-sets" aria-label="Bench Press sets">
        {children}
      </ul>
    </section>
  );
}

/** The three states in one frame. The point of the story. */
export const EveryState: StoryObj<Props> = {
  render: () => (
    <Card>
      <Row index={1} set={draftSet('pending')} />
      <Row index={2} set={draftSet('completed', { weightKg: 100, reps: 5 })} />
      <Row index={3} set={draftSet('failed', { weightKg: 100, reps: 3 })} />
    </Card>
  ),
};

/**
 * A ghosted row: last session's numbers, tappable as-is, visibly not entered data.
 *
 * Muted, lighter *and* dashed-underlined — three signals, never colour alone.
 */
export const Ghosted: StoryObj<Props> = {
  render: () => (
    <Card>
      <Row index={1} set={draftSet('pending')} />
    </Card>
  ),
};

/**
 * The editor open: a number, the outcome in words, and one quiet way to delete.
 *
 * It used to add two rows of controls — a stepper, then a large filled-red ✗ beside a
 * ✓ — while the row above still showed its own value and its own state button. Four
 * unlabelled ways to act on one number, the loudest of them destructive.
 */
export const EditorOpen: StoryObj<Props> = {
  render: () => (
    <Card>
      <Row index={1} set={draftSet('pending')} openField="weight" />
    </Card>
  ),
};

/** A warmup: a letter rather than a number, and subordinate to the working sets. */
export const Warmup: StoryObj<Props> = {
  render: () => (
    <Card>
      <Row index={1} set={draftSet('completed', { type: 'warmup', weightKg: 60, reps: 5 })} />
      <Row index={1} set={draftSet('pending')} />
    </Card>
  ),
};
