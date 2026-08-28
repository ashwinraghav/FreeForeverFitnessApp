import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { MUSCLE_GROUPS, EQUIPMENT } from '@freeforever/data';
import { describe, expect, it } from 'vitest';

import {
  adaptCatalogue,
  shoulderGroupFor,
  toCatalogueEntry,
  unmappedEquipmentNames,
  unmappedMuscleNames,
  type DatasetExercise,
} from './fromDatasets.js';
import { searchExercises } from './search.js';

/**
 * The adapter is validated against the **real** 873 rows, not a fixture.
 *
 * A fixture would prove the adapter handles the shapes I already thought of. Reading
 * the shipped artefact proves it handles the ones upstream actually has — and it
 * fails the day free-exercise-db is rebuilt with a muscle name or an equipment name
 * this file does not map, which is precisely the change that would otherwise ship a
 * silently empty muscle split.
 *
 * The file is read off disk with `node:zlib` rather than imported, because
 * `@freeforever/datasets` does not publish a path to it — see the module comment in
 * `fromDatasets.ts`. That is the one thing blocking the swap, and this test is written
 * so it needs no changes when the blocker clears.
 */

interface Catalogue {
  readonly count: number;
  readonly exercises: readonly DatasetExercise[];
}

/**
 * Read the artefact off disk by path.
 *
 * Not `require.resolve` and not an import: the datasets `exports` field publishes
 * only `"."`, so even `@freeforever/datasets/package.json` is refused. Walking the
 * repo is the honest way to reach it from a test, and it documents the blocker —
 * the day datasets publishes a path, this becomes an import and nothing else here
 * changes.
 */
const CATALOGUE_PATH = fileURLToPath(
  new URL('../../../../../../packages/datasets/build/exercises.json.gz', import.meta.url),
);

function loadRealCatalogue(): Catalogue {
  // `TextDecoder` rather than `Buffer.toString('utf8')`: `@types/node` is not in this
  // package's tsconfig `types` array, so `Buffer` degrades to `Object` and the
  // encoding argument is a type error. `TextDecoder` comes from lib.dom and needs no
  // extra types.
  const bytes = gunzipSync(readFileSync(CATALOGUE_PATH));
  return JSON.parse(new TextDecoder().decode(bytes)) as Catalogue;
}

const real = loadRealCatalogue();
const adapted = adaptCatalogue(real.exercises);

describe('the shipped catalogue', () => {
  it('is the 873 rows the manifest claims', () => {
    expect(real.count).toBe(873);
    expect(real.exercises).toHaveLength(873);
  });
});

describe('vocabulary coverage — the test that catches an upstream rebuild', () => {
  it('maps every muscle name upstream uses', () => {
    expect(unmappedMuscleNames(real.exercises)).toEqual([]);
  });

  it('maps every equipment name upstream uses', () => {
    expect(unmappedEquipmentNames(real.exercises)).toEqual([]);
  });

  it('never emits a muscle outside MUSCLE_GROUPS', () => {
    const allowed = new Set<string>(MUSCLE_GROUPS);
    for (const entry of adapted) {
      for (const share of entry.muscles) expect(allowed.has(share.muscle)).toBe(true);
    }
  });

  it('never emits equipment outside EQUIPMENT', () => {
    const allowed = new Set<string>(EQUIPMENT);
    for (const entry of adapted) expect(allowed.has(entry.equipment)).toBe(true);
  });
});

describe('every adapted row is a valid CatalogueEntry', () => {
  it('converts essentially all of them', () => {
    // A row is dropped only when none of its muscles map, which should be nothing.
    expect(adapted.length).toBe(873);
  });

  it('gives every row at least one muscle and no more than twelve', () => {
    // `muscleContributionSchema` bounds the array at 12; an empty array fails Zod.
    for (const entry of adapted) {
      expect(entry.muscles.length).toBeGreaterThanOrEqual(1);
      expect(entry.muscles.length).toBeLessThanOrEqual(12);
    }
  });

  it('gives every row a primary mover at 1.0', () => {
    for (const entry of adapted) {
      expect(entry.muscles.some((share) => share.fraction === 1)).toBe(true);
    }
  });

  it('never double-counts a muscle listed as both primary and secondary', () => {
    for (const entry of adapted) {
      const names = entry.muscles.map((share) => share.muscle);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('keeps every fraction inside the schema’s bounds', () => {
    for (const entry of adapted) {
      for (const share of entry.muscles) {
        expect(share.fraction).toBeGreaterThan(0);
        expect(share.fraction).toBeLessThanOrEqual(1);
      }
    }
  });

  it('gives every row a unique id', () => {
    const ids = adapted.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every row a name that fits displayNameSchema', () => {
    for (const entry of adapted) {
      expect(entry.name.length).toBeGreaterThanOrEqual(1);
      expect(entry.name.length).toBeLessThanOrEqual(120);
    }
  });
});

describe('the shoulders inference, stated as an inference', () => {
  it('sends a press to the front delt and a row to the rear', () => {
    expect(shoulderGroupFor('push')).toBe('front_delts');
    expect(shoulderGroupFor('pull')).toBe('rear_delts');
    expect(shoulderGroupFor('static')).toBe('side_delts');
    expect(shoulderGroupFor(null)).toBe('side_delts');
  });

  it('splits the upstream single shoulder across all three delts in practice', () => {
    // If every `shoulders` collapsed to one group the split would be worthless.
    const delts = new Set(
      adapted.flatMap((entry) =>
        entry.muscles.map((share) => share.muscle).filter((m) => m.endsWith('_delts')),
      ),
    );
    expect(delts).toEqual(new Set(['front_delts', 'side_delts', 'rear_delts']));
  });
});

describe('inferred load and effort kinds', () => {
  const byName = (pattern: RegExp) => adapted.filter((entry) => pattern.test(entry.name));

  it('marks assisted machine work as assisted, so progress does not read as regression', () => {
    const assisted = byName(/assisted/i);
    expect(assisted.length).toBeGreaterThan(0);
    for (const entry of assisted) expect(entry.loadKind).toBe('assisted');
  });

  it('marks a pull-up as bodyweight, not external', () => {
    const pullUps = adapted.filter((entry) => /^Pullups$|Pull[- ]?up/i.test(entry.name));
    expect(pullUps.length).toBeGreaterThan(0);
    expect(pullUps.some((entry) => entry.loadKind === 'bodyweight')).toBe(true);
  });

  it('measures a plank on a clock', () => {
    const planks = byName(/plank/i);
    expect(planks.length).toBeGreaterThan(0);
    for (const entry of planks) {
      expect(entry.effortKind).toBe('duration');
      expect(entry.loadKind).toBe('none');
    }
  });

  it('measures a carry in distance', () => {
    const carries = byName(/carry|farmer/i);
    expect(carries.length).toBeGreaterThan(0);
    for (const entry of carries) expect(entry.effortKind).toBe('distance');
  });

  it('falls through to weight-and-reps, the shape that degrades most gracefully', () => {
    const bench = adapted.find((entry) => entry.id === 'Barbell_Bench_Press_-_Medium_Grip');
    expect(bench?.loadKind).toBe('external');
    expect(bench?.effortKind).toBe('reps');
    expect(bench?.equipment).toBe('barbell');
  });

  it('leaves the overwhelming majority as reps, rather than over-inferring', () => {
    const reps = adapted.filter((entry) => entry.effortKind === 'reps');
    expect(reps.length / adapted.length).toBeGreaterThan(0.7);
  });
});

describe('a known row, converted end to end', () => {
  it('turns the barbell bench press into the right split', () => {
    const bench = adapted.find((entry) => entry.id === 'Barbell_Bench_Press_-_Medium_Grip');
    expect(bench?.muscles).toEqual([
      { muscle: 'chest', fraction: 1 },
      // `shoulders` + force `push` becomes the front delt, at the secondary weight.
      { muscle: 'front_delts', fraction: 0.5 },
      { muscle: 'triceps', fraction: 0.5 },
    ]);
  });

  it('drops a row whose muscles cannot be represented at all', () => {
    const nonsense: DatasetExercise = {
      id: 'x',
      name: 'Mystery Move',
      primaryMuscles: ['spleen'],
      secondaryMuscles: [],
    };
    // Silently keeping it would put a loggable exercise in the picker that
    // contributes to no muscle and vanishes from every volume chart.
    expect(toCatalogueEntry(nonsense)).toBeNull();
  });

  it('survives a row with no muscles, no equipment and no aliases', () => {
    expect(toCatalogueEntry({ id: 'x', name: 'Bare' })).toBeNull();
  });
});

describe('search works against the real catalogue', () => {
  it('finds the bench press among 873 rows', () => {
    const hits = searchExercises('bench press', adapted, { limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.entry.name).toMatch(/Bench Press/i);
  });

  it('still answers gym shorthand', () => {
    expect(searchExercises('bench', adapted, { limit: 5 })[0]?.entry.name).toMatch(/Bench/i);
  });

  it('is fast enough to run on every keystroke', () => {
    // A linear scan over 873 pre-folded rows. If this ever creeps past a frame the
    // picker needs an inverted index; the point of the assertion is to notice.
    searchExercises('be', adapted); // warm the fold cache
    const started = performance.now();
    for (const query of ['b', 'be', 'ben', 'benc', 'bench']) searchExercises(query, adapted);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
