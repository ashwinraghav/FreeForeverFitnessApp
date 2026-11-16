import type { Equipment, ExerciseId, LoadKind, MuscleGroup } from '@freeforever/data';

import type { CatalogueEntry } from '../catalogue/types.js';

/**
 * Exercises the lifter wrote down themselves.
 *
 * The picker could only ever hand back a `CatalogueEntry`, so a movement the bundled
 * 873 did not name could not be logged at all — the search said "Nothing matches" and
 * offered a shorter word. Meanwhile `ExerciseCard` already carried a comment reading
 * "undefined for a custom exercise with no entry", and `EXERCISE_SOURCES` has listed
 * `'custom'` since the schema was written. The shape was agreed; nothing could make one.
 *
 * ## It is a `CatalogueEntry`, not a parallel type
 *
 * A custom exercise enters the same array the bundled ones do, so search, the body-part
 * chips, the equipment filters, recents, recommendations and `toExerciseRef` all work on
 * it without knowing it exists. The alternative — a second list the picker concatenates
 * at render time — would have meant teaching every one of those about a second shape,
 * which is how one feature becomes six.
 *
 * ## Ids
 *
 * `cx-<base36 time>-<base36 random>`, which satisfies `exerciseIdSchema`
 * (`^[A-Za-z0-9_-]{1,64}$`) and cannot collide with a bundled id: the dataset slugs names
 * into `Ab_Crunch_Machine` and `3_4_Sit-Up`, and nothing in the shipped 873 begins `cx-`
 * (checked) or contains `~` (which `exerciseKey` reserves as the variant separator).
 *
 * The id matters more than it looks. `exerciseKey` is what a personal record is tracked
 * against, so a custom id is in the lifter's history the moment they log a set with it —
 * and must therefore never be reissued or renamed. `remove` drops the entry from the
 * picker; it deliberately does **not** touch history, because a logged set stores its own
 * `name` and `muscles` (SCHEMA.md) and renders fine without the catalogue row.
 *
 * ## Storage
 *
 * `localStorage`, wrapped exactly as `workoutStore` wraps it and for the same three real
 * cases: Safari private browsing, a full quota, and a webview with site data disabled.
 * A failed read degrades to "no custom exercises" rather than throwing inside the picker,
 * which would white-screen the one control the lifter opened to get unstuck. A failed
 * write is reported to the caller so the form can say so instead of appearing to succeed.
 *
 * The `ff.` prefix is not decorative: `shell/firstRun.ts` decides whether somebody is new
 * by scanning for `^ff[.:]`, so a key outside that convention would make a returning
 * lifter look like a first-time one.
 */

const KEY = 'ff.workout.custom.v1';

/** Bounded so a runaway loop cannot fill the quota and take the session store with it. */
export const MAX_CUSTOM_EXERCISES = 200;

/** `displayNameSchema` bounds the stored name; this is the same limit, enforced early. */
export const MAX_NAME_LENGTH = 80;

export interface CustomExerciseDraft {
  readonly name: string;
  readonly muscle: MuscleGroup;
  readonly loadKind: LoadKind;
  readonly effortKind: 'reps' | 'duration';
  readonly equipment: Equipment;
}

export type SaveResult =
  | { readonly ok: true; readonly entry: CatalogueEntry }
  | { readonly ok: false; readonly reason: 'empty' | 'too-many' | 'unwritable' };

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function newId(): ExerciseId {
  const time = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 0xffffff).toString(36);
  return `cx-${time}-${rand}` as ExerciseId;
}

/**
 * One muscle at 1.0, and that is not the all-1.0 split the schema warns about.
 *
 * `muscleContributionSchema` exists because a bench press logged as 1.0 chest *and* 1.0
 * triceps double-counts every volume chart. The warning is about spreading 1.0 across
 * several muscles, not about a single named mover. Asking a lifter to apportion
 * fractions across synergists in a mid-workout sheet would be absurd and would produce
 * worse numbers than one honest primary.
 */
function musclesFor(muscle: MuscleGroup): CatalogueEntry['muscles'] {
  return [{ muscle, fraction: 1 }];
}

export function toCatalogueEntry(draft: CustomExerciseDraft, id: ExerciseId): CatalogueEntry {
  return {
    id,
    name: draft.name,
    aliases: [],
    equipment: draft.equipment,
    loadKind: draft.loadKind,
    effortKind: draft.effortKind,
    muscles: musclesFor(draft.muscle),
    // Not asked. A lifter who has just told us the app does not know their movement is
    // not the person to interrogate about whether volume should count both limbs, and
    // `false` is the answer that cannot inflate a total.
    unilateral: false,
  };
}

function parse(raw: string | null): readonly CatalogueEntry[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Shape-checked rather than trusted: this is the lifter's own disk, but a half-written
    // value from a killed tab would otherwise reach `search` and throw on every keystroke.
    return parsed.filter(
      (row): row is CatalogueEntry =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as CatalogueEntry).id === 'string' &&
        typeof (row as CatalogueEntry).name === 'string' &&
        Array.isArray((row as CatalogueEntry).muscles) &&
        (row as CatalogueEntry).muscles.length > 0,
    );
  } catch {
    return [];
  }
}

export function listCustomExercises(): readonly CatalogueEntry[] {
  const store = storage();
  if (store === null) return [];
  try {
    return parse(store.getItem(KEY));
  } catch {
    return [];
  }
}

export function saveCustomExercise(draft: CustomExerciseDraft): SaveResult {
  const name = draft.name.trim().slice(0, MAX_NAME_LENGTH);
  if (name === '') return { ok: false, reason: 'empty' };

  const existing = listCustomExercises();
  if (existing.length >= MAX_CUSTOM_EXERCISES) return { ok: false, reason: 'too-many' };

  const entry = toCatalogueEntry({ ...draft, name }, newId());
  const store = storage();
  if (store === null) return { ok: false, reason: 'unwritable' };
  try {
    store.setItem(KEY, JSON.stringify([...existing, entry]));
  } catch {
    return { ok: false, reason: 'unwritable' };
  }
  return { ok: true, entry };
}

/**
 * Drop one from the picker. History that already references it is untouched by design —
 * see the note on ids above.
 */
export function removeCustomExercise(id: ExerciseId): boolean {
  const store = storage();
  if (store === null) return false;
  const next = listCustomExercises().filter((entry) => entry.id !== id);
  try {
    store.setItem(KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
