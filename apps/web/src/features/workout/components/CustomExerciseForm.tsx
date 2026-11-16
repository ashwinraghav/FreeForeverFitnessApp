import { Button, Select, TextField } from '@freeforever/design-system';
import type { Equipment, LoadKind, MuscleGroup } from '@freeforever/data';
import { useState } from 'react';

import type { CatalogueEntry } from '../catalogue/types.js';
import { MAX_NAME_LENGTH, saveCustomExercise } from '../storage/customExercises.js';

/**
 * Writing down a movement the bundled catalogue does not have.
 *
 * Rendered *inside* the picker's existing Sheet rather than as a Sheet or Dialog of its
 * own. Two reasons: CLAUDE.md forbids a modal mid-workout, and a second sheet stacked on
 * the first is exactly the dismissal that loses entered work. The picker swaps its result
 * list for this panel and swaps back, so there is only ever one surface and Close means
 * the same thing throughout.
 *
 * ## Four questions, and the argument for each one not asked
 *
 * The lifter is standing between sets having just been told the app does not know their
 * exercise. Every field is a reason to give up, so the form asks only what a logged set
 * cannot be rendered or counted without:
 *
 *   - **Name** — prefilled from the search they already typed. Usually zero typing.
 *   - **Main muscle** — `muscles` is non-empty in the schema and volume charts read it.
 *     One primary, no fractions: see the note in `customExercises.ts`.
 *   - **What you count** — reps or time. Picks `effortKind`; a plank and a row do not
 *     compare and the set editor renders differently for each.
 *   - **How it is loaded** — drives `loadKind`, which drives plate maths and e1RM.
 *     Assisted is deliberately absent: it exists in `LOAD_KINDS` for machines whose
 *     stack makes the lift *easier*, and someone who needs that distinction is describing
 *     a machine the catalogue almost certainly has.
 *
 * Not asked: equipment (derived below), unilateral (defaulted false, which cannot inflate
 * a volume total), aliases (the name they typed is already the alias), and every muscle
 * past the first.
 *
 * ## Labels live here
 *
 * `insights/data/ports.ts` has a `MUSCLE_LABELS` map, and importing it would be the first
 * cross-feature import in either direction — there are currently zero, which looks
 * deliberate (ADR-0018). Twenty-one strings duplicated is the cheaper of the two debts;
 * if a third feature needs them the map belongs in the design system or `packages/data`,
 * not in a web of sideways imports.
 */

const MUSCLE_LABELS: Readonly<Record<MuscleGroup, string>> = {
  chest: 'Chest',
  front_delts: 'Front delts',
  side_delts: 'Side delts',
  rear_delts: 'Rear delts',
  lats: 'Lats',
  upper_back: 'Upper back',
  traps: 'Traps',
  lower_back: 'Lower back',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  abs: 'Abs',
  obliques: 'Obliques',
  glutes: 'Glutes',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  adductors: 'Adductors',
  abductors: 'Abductors',
  calves: 'Calves',
  neck: 'Neck',
  full_body: 'Full body',
};

/** Ordered by how often a lifter reaches for them, not alphabetically. */
const MUSCLE_ORDER: readonly MuscleGroup[] = [
  'chest',
  'lats',
  'upper_back',
  'quads',
  'hamstrings',
  'glutes',
  'front_delts',
  'side_delts',
  'rear_delts',
  'biceps',
  'triceps',
  'abs',
  'obliques',
  'calves',
  'forearms',
  'traps',
  'lower_back',
  'adductors',
  'abductors',
  'neck',
  'full_body',
];

type LoadChoice = 'weight' | 'bodyweight' | 'none';

const LOAD_KIND: Readonly<Record<LoadChoice, LoadKind>> = {
  weight: 'external',
  bodyweight: 'bodyweight',
  none: 'none',
};

/**
 * Equipment is derived rather than asked.
 *
 * It only drives the picker's equipment chips, and a lifter filtering by "barbell" is
 * looking for a bundled lift, not the one they invented thirty seconds ago. `other` keeps
 * a custom entry out of every equipment filter, which is the honest answer: we do not
 * know what it is on.
 */
const EQUIPMENT: Readonly<Record<LoadChoice, Equipment>> = {
  weight: 'other',
  bodyweight: 'bodyweight',
  none: 'other',
};

const FAILURE: Readonly<Record<'empty' | 'too-many' | 'unwritable', string>> = {
  empty: 'Give it a name first.',
  'too-many': 'That is as many custom exercises as this device will hold. Remove one first.',
  // Named for the cause, because the fix is different: this is storage refusing, not us.
  unwritable:
    'This browser would not save it. Private browsing and blocked site data both do that.',
};

export interface CustomExerciseFormProps {
  /** What they typed in the search box. Becomes the name, so it is usually right already. */
  readonly initialName: string;
  readonly onCreated: (entry: CatalogueEntry) => void;
  readonly onCancel: () => void;
}

export function CustomExerciseForm({
  initialName,
  onCreated,
  onCancel,
}: CustomExerciseFormProps) {
  const [name, setName] = useState(initialName.slice(0, MAX_NAME_LENGTH));
  const [muscle, setMuscle] = useState<MuscleGroup>('chest');
  const [counts, setCounts] = useState<'reps' | 'duration'>('reps');
  const [load, setLoad] = useState<LoadChoice>('weight');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const result = saveCustomExercise({
      name,
      muscle,
      loadKind: LOAD_KIND[load],
      effortKind: counts,
      equipment: EQUIPMENT[load],
    });
    if (!result.ok) {
      setError(FAILURE[result.reason]);
      return;
    }
    onCreated(result.entry);
  };

  return (
    <form className="ffw-custom" onSubmit={submit}>
      <p className="ffw-note">
        It will be saved on this device and appear in search from now on.
      </p>

      <TextField
        label="Name"
        value={name}
        maxLength={MAX_NAME_LENGTH}
        autoComplete="off"
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        autoFocus
      />

      <Select
        label="Main muscle"
        value={muscle}
        onChange={(event) => setMuscle(event.currentTarget.value as MuscleGroup)}
        hint="What it mostly trains. Used for your volume charts."
      >
        {MUSCLE_ORDER.map((group) => (
          <option key={group} value={group}>
            {MUSCLE_LABELS[group]}
          </option>
        ))}
      </Select>

      <Select
        label="What you count"
        value={counts}
        onChange={(event) => setCounts(event.currentTarget.value as 'reps' | 'duration')}
      >
        <option value="reps">Reps</option>
        <option value="duration">Time</option>
      </Select>

      <Select
        label="How it is loaded"
        value={load}
        onChange={(event) => setLoad(event.currentTarget.value as LoadChoice)}
      >
        <option value="weight">Added weight</option>
        <option value="bodyweight">Bodyweight</option>
        <option value="none">No weight</option>
      </Select>

      {/*
        role="alert" so a save that failed is announced rather than only drawn — the
        lifter is looking at their hands, not the screen, and a silent failure here means
        they tap Add again and lose the set they were about to log.
      */}
      {error === null ? null : (
        <p className="ffw-custom__error" role="alert">
          {error}
        </p>
      )}

      <div className="ffw-custom__actions">
        <Button type="submit" variant="primary" size="xl">
          Add and use it
        </Button>
        <Button type="button" variant="ghost" size="xl" onClick={onCancel}>
          Back to search
        </Button>
      </div>
    </form>
  );
}
