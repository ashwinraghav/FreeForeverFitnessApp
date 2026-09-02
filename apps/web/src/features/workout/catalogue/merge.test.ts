import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import type { ExerciseId } from '@freeforever/data';

import { adaptCatalogue, type DatasetExercise } from './fromDatasets.js';
import { mergeCatalogues, normaliseName } from './merge.js';
import { searchExercises } from './search.js';
import { STARTER_CATALOGUE } from './starter.js';
import type { CatalogueEntry } from './types.js';

const CATALOGUE_PATH = fileURLToPath(
  new URL('../../../../../../packages/datasets/build/exercises.json.gz', import.meta.url),
);

function realExercises(): readonly DatasetExercise[] {
  const bytes = gunzipSync(readFileSync(CATALOGUE_PATH));
  return (JSON.parse(new TextDecoder().decode(bytes)) as { exercises: DatasetExercise[] })
    .exercises;
}

const merged = mergeCatalogues(STARTER_CATALOGUE, adaptCatalogue(realExercises()));

/** What the picker would show for a query, in order. */
const names = (query: string): string[] =>
  searchExercises(query, merged, { limit: 10 }).map((hit) => hit.entry.name);

describe('the litmus test', () => {
  /*
   * Set by the project owner: "whether you have a comprehensive list is whether
   * straight arm pulldown lands". It did not, before this merge — the picker searched
   * 70 hand-written entries while 873 sat unread in the deployed bundle.
   */
  it('finds a straight-arm pulldown', () => {
    expect(names('straight arm pulldown')[0]).toBe('Straight-Arm Pulldown');
  });

  it('finds it the way it would actually be typed', () => {
    // No hyphen, and stopping early — nobody types the whole thing on a phone.
    expect(names('straight arm pull')).toContain('Straight-Arm Pulldown');
    expect(names('straight-arm pulldown')).toContain('Straight-Arm Pulldown');
  });

  it('finds the other lifts that were missing with it', () => {
    for (const [query, expected] of [
      ['face pull', /face pull/i],
      ['pullover', /pullover/i],
      ['hammer curl', /hammer curl/i],
      ['preacher curl', /preacher curl/i],
      ['cable fly', /(fly|flye)/i],
      ['skullcrusher', /skullcrusher/i],
      ['shrug', /shrug/i],
    ] as const) {
      expect(names(query).join(' | ')).toMatch(expected);
    }
  });
});

describe('merging the dataset in behind the starter set', () => {
  it('keeps every starter entry, with its id untouched', () => {
    // Not cosmetic: a logged set stores `exerciseId`, so a renamed id orphans history.
    for (const entry of STARTER_CATALOGUE) {
      expect(merged.find((candidate) => candidate.id === entry.id)).toEqual(entry);
    }
  });

  it('puts the starter entries first, so the common lifts rank above the long tail', () => {
    expect(merged.slice(0, STARTER_CATALOGUE.length)).toEqual([...STARTER_CATALOGUE]);
  });

  it('grows the catalogue by an order of magnitude', () => {
    expect(STARTER_CATALOGUE.length).toBe(70);
    expect(merged.length).toBeGreaterThan(850);
  });

  it('issues no duplicate ids', () => {
    expect(new Set(merged.map((entry) => entry.id)).size).toBe(merged.length);
  });

  it('drops the dataset row when it is the same lift under the same name', () => {
    const squats = merged.filter((entry) => normaliseName(entry.name) === 'back squat');
    expect(squats).toHaveLength(1);
    expect(squats[0]!.id).toBe('back-squat');
  });

  it('drops a dataset row that only spells out the equipment we already record', () => {
    // "Barbell Deadlift" is our "Deadlift", which is a barbell lift.
    expect(merged.some((entry) => normaliseName(entry.name) === 'barbell deadlift')).toBe(false);
    expect(merged.some((entry) => entry.id === 'deadlift')).toBe(true);
  });

  it('keeps a dataset row whose equipment differs, however similar the name', () => {
    // The starter bench press is a barbell. A dumbbell bench press is a different lift
    // and dropping it would be exactly the bug this merge exists to fix.
    const bench = merged.filter((entry) => /bench press/i.test(entry.name));
    expect(bench.length).toBeGreaterThan(3);
    expect(bench.some((entry) => /dumbbell/i.test(entry.name))).toBe(true);
  });

  it('keeps variants that merely contain a starter name', () => {
    // "Incline Bench Press" contains "Bench Press" and is not the same exercise. 157
    // dataset rows contain a starter name, so containment must never mean duplicate.
    expect(merged.some((entry) => /incline/i.test(entry.name))).toBe(true);
    expect(merged.some((entry) => /close.grip/i.test(entry.name))).toBe(true);
  });
});

describe('mergeCatalogues in isolation', () => {
  // `Omit` the id before intersecting: `Partial<CatalogueEntry>['id']` is already
  // branded, so a plain intersection keeps the brand and refuses a literal.
  const entry = (
    over: Omit<Partial<CatalogueEntry>, 'id'> & { readonly id: string },
  ): CatalogueEntry => ({
    name: 'X',
    aliases: [],
    equipment: 'barbell',
    loadKind: 'external',
    effortKind: 'reps',
    muscles: [],
    unilateral: false,
    ...over,
    // After the spread, so the branded cast is not undone by it.
    id: over.id as ExerciseId,
  });

  it('matches a dataset name against a starter alias, not just its name', () => {
    const starter = [entry({ id: 'ohp', name: 'Overhead Press', aliases: ['military press'] })];
    const extra = [entry({ id: 'Military_Press', name: 'Military Press' })];
    expect(mergeCatalogues(starter, extra)).toHaveLength(1);
  });

  it('refuses a dataset row that would reuse a starter id', () => {
    const starter = [entry({ id: 'clash', name: 'Ours' })];
    const extra = [entry({ id: 'clash', name: 'Theirs' })];
    const out = mergeCatalogues(starter, extra);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('Ours');
  });

  it('folds punctuation and case when comparing', () => {
    const starter = [entry({ id: 'ez', name: 'EZ-Bar Curl' })];
    const extra = [entry({ id: 'ez2', name: 'ez bar   curl' })];
    expect(mergeCatalogues(starter, extra)).toHaveLength(1);
  });
});
