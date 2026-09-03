import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { BODY_PART_FILTERS, leadingMuscles, matchesBodyParts, type BodyPart } from './bodyParts.js';
import { adaptCatalogue, type DatasetExercise } from './fromDatasets.js';
import { mergeCatalogues } from './merge.js';
import { STARTER_CATALOGUE } from './starter.js';
import type { CatalogueEntry } from './types.js';

const FULL = mergeCatalogues(
  STARTER_CATALOGUE,
  adaptCatalogue(
    (
      JSON.parse(
        new TextDecoder().decode(
          gunzipSync(
            readFileSync(
              fileURLToPath(
                new URL(
                  '../../../../../../packages/datasets/build/exercises.json.gz',
                  import.meta.url,
                ),
              ),
            ),
          ),
        ),
      ) as { exercises: DatasetExercise[] }
    ).exercises,
  ),
);

const inPart = (part: BodyPart, catalogue: readonly CatalogueEntry[] = FULL) =>
  catalogue.filter((entry) => matchesBodyParts(entry, [part]));

const byId = (id: string) => FULL.find((entry) => entry.id === id)!;
const named = (name: string) => FULL.find((entry) => entry.name === name)!;

describe('the muscle ordering contract the filter depends on', () => {
  /*
   * `CatalogueEntry.muscles` is documented as ordered most-primary first, and three
   * curated entries were not: Hammer Curl, Dip and Trap Bar Deadlift each listed a
   * bigger fraction later. Anything reading `muscles[0]` as "the muscle this is for"
   * was wrong about them — `recommend.ts` bucketed Dip under chest.
   */
  it('holds for every entry in the merged catalogue', () => {
    const broken = FULL.filter((entry) =>
      entry.muscles.some(
        (share, index) => index > 0 && share.fraction > (entry.muscles[0]?.fraction ?? 0),
      ),
    ).map((entry) => `${entry.name}: ${entry.muscles.map((s) => `${s.muscle}=${s.fraction}`).join(' ')}`);

    expect(broken).toEqual([]);
  });

  it('now calls the dip a triceps exercise, which its own numbers already said', () => {
    expect(byId('dip').muscles[0]?.muscle).toBe('triceps');
  });
});

describe('what an exercise is for', () => {
  it('ignores a secondary muscle on the adapted two-value scale', () => {
    // Upstream gives primary 1.0 and secondary 0.5, so a bare `>= 0.5` threshold
    // matched every muscle an exercise listed at all — 419 of 913 under "arms".
    const bench = named('Barbell Bench Press - Medium Grip');
    expect(bench.muscles.some((share) => share.muscle === 'triceps')).toBe(true);
    expect(leadingMuscles(bench)).not.toContain('triceps');
    expect(leadingMuscles(bench)).toContain('chest');
  });

  it('keeps a near-leading muscle on the curated graded scale', () => {
    // Trap Bar Deadlift is glutes 1, quads 0.8, hamstrings 0.7. The first two are what
    // it is for; a strict maximum would have kept only the glutes.
    expect(leadingMuscles(byId('trap-bar-deadlift'))).toEqual(
      expect.arrayContaining(['glutes', 'quads']),
    );
    expect(leadingMuscles(byId('trap-bar-deadlift'))).not.toContain('lower_back');
  });

  it('says nothing about an exercise that lists no muscles', () => {
    const empty: CatalogueEntry = { ...byId('dip'), muscles: [] };
    expect(leadingMuscles(empty)).toEqual([]);
    // And a no-muscle entry must not silently pass a filter it cannot be judged against.
    expect(matchesBodyParts(empty, ['push'])).toBe(false);
  });
});

describe('the split follows the training convention', () => {
  it('puts rear delts on pull day, not push day', () => {
    /*
     * The one finding from the research that changes the grouping. Rear delts work
     * hardest in rows and pull-ups rather than overhead pressing, so they belong with
     * back. Most apps cannot express this because they model shoulders as one muscle;
     * `MUSCLE_GROUPS` splits the three heads, which is why it is available here.
     */
    const pull = BODY_PART_FILTERS.find((f) => f.value === 'pull')!;
    const push = BODY_PART_FILTERS.find((f) => f.value === 'push')!;
    expect(pull.muscles).toContain('rear_delts');
    expect(push.muscles).not.toContain('rear_delts');

    expect(matchesBodyParts(byId('face-pull'), ['pull'])).toBe(true);
    expect(matchesBodyParts(byId('face-pull'), ['push'])).toBe(false);
    expect(matchesBodyParts(byId('rear-delt-fly'), ['pull'])).toBe(true);
  });

  it('keeps the front and side delts on push day', () => {
    for (const id of ['overhead-press', 'lateral-raise']) {
      expect(matchesBodyParts(byId(id), ['push'])).toBe(true);
      expect(matchesBodyParts(byId(id), ['pull'])).toBe(false);
    }
  });

  it('pairs triceps with chest and biceps with back, as the split does', () => {
    expect(matchesBodyParts(byId('cable-tricep-pushdown'), ['push'])).toBe(true);
    expect(matchesBodyParts(byId('barbell-curl'), ['pull'])).toBe(true);
  });

  it('files the obvious lifts where a lifter would look for them', () => {
    for (const [id, part] of [
      ['bench-press', 'push'],
      ['incline-bench-press', 'push'],
      ['barbell-row', 'pull'],
      ['lat-pulldown', 'pull'],
      ['pull-up', 'pull'],
      ['back-squat', 'legs'],
      ['romanian-deadlift', 'legs'],
      ['calf-raise', 'legs'],
      ['plank', 'core'],
      ['hanging-leg-raise', 'core'],
    ] as const) {
      expect(matchesBodyParts(byId(id), [part]), `${id} should be ${part}`).toBe(true);
    }
  });
});

describe('every chip is worth tapping', () => {
  for (const filter of BODY_PART_FILTERS) {
    it(`${filter.label} returns a usable number of exercises`, () => {
      // A chip that returns four things is a dead end. Measured floors, well under the
      // real counts (269 / 204 / 314 / 122) so an upstream rebuild does not fail this.
      expect(inPart(filter.value).length).toBeGreaterThan(80);
    });

    it(`${filter.label} includes some of the curated seventy`, () => {
      // The long tail is for finding; the curated lifts are what most people want, so
      // every chip has to surface some of them rather than only obscure variants.
      expect(inPart(filter.value, STARTER_CATALOGUE).length).toBeGreaterThan(3);
    });
  }

  it('gives every curated exercise a home', () => {
    const parts = BODY_PART_FILTERS.map((f) => f.value);
    const homeless = STARTER_CATALOGUE.filter((entry) => !matchesBodyParts(entry, parts)).map(
      (entry) => entry.name,
    );
    expect(homeless).toEqual([]);
  });

  it('leaves almost nothing in the whole catalogue homeless', () => {
    const parts = BODY_PART_FILTERS.map((f) => f.value);
    const homeless = FULL.filter((entry) => !matchesBodyParts(entry, parts));
    // Eight, all of them neck exercises, which no chip should claim.
    expect(homeless.length).toBeLessThan(15);
    for (const entry of homeless) expect(leadingMuscles(entry)).toContain('neck');
  });

  it('does not put half the catalogue behind one chip', () => {
    // The failure mode of a loose membership rule: "arms" once matched 419 of 913.
    for (const filter of BODY_PART_FILTERS) {
      expect(inPart(filter.value).length).toBeLessThan(FULL.length / 2);
    }
  });

  it('barely overlaps between chips', () => {
    const multi = FULL.filter(
      (entry) => BODY_PART_FILTERS.filter((f) => matchesBodyParts(entry, [f.value])).length > 1,
    );
    // A near-partition, not a taxonomy. The few that double up are lying rear and side
    // lateral raises, where the answer is genuinely arguable.
    expect(multi.length).toBeLessThan(20);
  });

  it('no filter means no filtering', () => {
    expect(matchesBodyParts(byId('bench-press'), [])).toBe(true);
  });
});
