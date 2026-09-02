import { describe, expect, it } from 'vitest';

import { STARTER_CATALOGUE } from './starter.js';
import { fold, searchExercises, tokenise } from './search.js';
import { toExerciseRef, type CatalogueEntry } from './types.js';

function names(query: string, options?: Parameters<typeof searchExercises>[2]): string[] {
  return searchExercises(query, STARTER_CATALOGUE, options).map((hit) => hit.entry.name);
}

describe('folding', () => {
  it('lowercases and strips punctuation', () => {
    expect(fold('Pull-Up')).toBe('pull up');
    expect(fold("Farmer's Carry")).toBe('farmer s carry');
    expect(fold('  Bench   Press  ')).toBe('bench press');
  });

  it('strips diacritics, because the gym keyboard has none', () => {
    expect(fold('Épaulé')).toBe('epaule');
    expect(fold('Müller')).toBe('muller');
  });

  it('tokenises to nothing for an empty query', () => {
    expect(tokenise('')).toEqual([]);
    expect(tokenise('   ')).toEqual([]);
    expect(tokenise('---')).toEqual([]);
  });
});

describe('finding the obvious thing', () => {
  it('puts the plain lift above the variation', () => {
    // Someone typing "bench" wants Bench Press, not Close-Grip Bench Press.
    expect(names('bench')[0]).toBe('Bench Press');
    expect(names('squat')[0]).toBe('Back Squat');
    expect(names('deadlift')[0]).toBe('Deadlift');
  });

  it('matches an exact name outright', () => {
    expect(names('overhead press')[0]).toBe('Overhead Press');
  });

  it('narrows as each character is typed and never goes blank on the way', () => {
    const target = 'Incline Dumbbell Press';
    for (const prefix of ['i', 'in', 'inc', 'incl', 'incli', 'inclin', 'incline']) {
      expect(names(prefix)).toContain(target);
    }
  });

  it('treats the last token as a prefix so multi-word typing works', () => {
    expect(names('inc du')).toContain('Incline Dumbbell Press');
    expect(names('incline d')).toContain('Incline Dumbbell Press');
  });

  it('ANDs the tokens', () => {
    // "incline row" must not match Incline Bench Press just because "incline" did.
    expect(names('incline row')).toEqual([]);
  });
});

describe('gym shorthand', () => {
  it.each([
    ['rdl', 'Romanian Deadlift'],
    ['ohp', 'Overhead Press'],
    ['bss', 'Bulgarian Split Squat'],
    ['db row', 'Dumbbell Row'],
    ['cgbp', 'Close-Grip Bench Press'],
    ['pulldown', 'Lat Pulldown'],
    ['erg', 'Rowing Machine'],
  ])('%s finds %s', (query, expected) => {
    expect(names(query)[0]).toBe(expected);
  });

  it('finds a hyphenated name typed without the hyphen', () => {
    expect(names('pullup')[0]).toBe('Pull-Up');
    expect(names('pull up')[0]).toBe('Pull-Up');
  });

  it('finds a possessive typed without the apostrophe', () => {
    expect(names('farmers')[0]).toBe("Farmer's Carry");
  });
});

describe('recents', () => {
  it('lists them first when the box is empty', () => {
    const recentIds = ['deadlift', 'bench-press'];
    expect(names('', { recentIds }).slice(0, 2)).toEqual(['Deadlift', 'Bench Press']);
  });

  it('follows catalogue order below the recents, not the alphabet', () => {
    /*
     * This used to assert alphabetical, which was right for a 70-entry hand-written
     * list and wrong the moment the 873-row dataset was merged in: the picker opened
     * on "3/4 Sit-Up" and "90/90 Hamstring" and buried every lift anybody does.
     *
     * Catalogue order is now the key, because `mergeCatalogues` puts the curated
     * seventy first and the dataset after them. The alphabet was never the point — the
     * point was a stable, predictable order, and this is a more useful one.
     */
    const listed = names('', { recentIds: ['deadlift'] });
    const expected = STARTER_CATALOGUE.filter((entry) => entry.id !== 'deadlift').map(
      (entry) => entry.name,
    );
    expect(listed[0]).toBe('Deadlift');
    expect(listed.slice(1)).toEqual(expected.slice(0, listed.length - 1));
  });

  it('puts recommendations above even the recents', () => {
    // The whole of coach mode: what you have not trained lately leads the browse list.
    const listed = names('', { recentIds: ['deadlift'], recommendedIds: ['face-pull'] });
    expect(listed.slice(0, 2)).toEqual(['Face Pull', 'Deadlift']);
  });

  it('stops reordering once the lifter types', () => {
    // They have said what they want; a recommendation must not outrank a real match.
    expect(names('bench press', { recommendedIds: ['face-pull'] })[0]).toBe('Bench Press');
  });

  it('breaks a tie between two equally good matches', () => {
    // "curl" matches several. The one done last week comes first.
    const withHammer = names('curl', { recentIds: ['hammer-curl'] });
    const without = names('curl');
    expect(withHammer[0]).toBe('Hammer Curl');
    expect(without[0]).not.toBe('Hammer Curl');
  });

  it('does not promote a recent past a genuinely better match', () => {
    // A recent lift gets a nudge, not a veto: typing the exact name of something else
    // must still put that first.
    expect(names('bench press', { recentIds: ['close-grip-bench'] })[0]).toBe('Bench Press');
  });

  it('is stable when the recent list is empty', () => {
    expect(names('', { recentIds: [] })).toEqual(names(''));
  });
});

describe('filters', () => {
  it('narrows by equipment', () => {
    const results = searchExercises('', STARTER_CATALOGUE, { equipment: ['bodyweight'], limit: 100 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((hit) => hit.entry.equipment === 'bodyweight')).toBe(true);
  });

  it('narrows by muscle', () => {
    const results = searchExercises('', STARTER_CATALOGUE, { muscle: 'calves', limit: 100 });
    expect(results.map((hit) => hit.entry.name)).toContain('Standing Calf Raise');
    expect(
      results.every((hit) => hit.entry.muscles.some((m) => m.muscle === 'calves')),
    ).toBe(true);
  });

  it('combines a filter with a query', () => {
    expect(names('press', { equipment: ['dumbbell'] }).every((n) => n.includes('Press'))).toBe(true);
    expect(names('press', { equipment: ['dumbbell'] })).not.toContain('Bench Press');
  });
});

describe('robustness', () => {
  it('returns nothing rather than throwing on gibberish', () => {
    expect(names('zzzzqqq')).toEqual([]);
  });

  it('handles an empty catalogue', () => {
    expect(searchExercises('bench', [])).toEqual([]);
  });

  it('respects the limit', () => {
    expect(searchExercises('', STARTER_CATALOGUE, { limit: 5 })).toHaveLength(5);
  });

  it('is deterministic', () => {
    expect(names('press')).toEqual(names('press'));
  });
});

describe('the starter catalogue itself', () => {
  it('has unique ids', () => {
    const ids = STARTER_CATALOGUE.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every exercise at least one muscle with a real fraction', () => {
    for (const entry of STARTER_CATALOGUE) {
      expect(entry.muscles.length).toBeGreaterThan(0);
      expect(entry.muscles.length).toBeLessThanOrEqual(12);
      expect(entry.muscles.some((share) => share.fraction === 1)).toBe(true);
      for (const share of entry.muscles) {
        expect(share.fraction).toBeGreaterThan(0);
        expect(share.fraction).toBeLessThanOrEqual(1);
      }
    }
  });

  it('does not give a compound lift an all-1.0 split', () => {
    // An all-1.0 split double-counts in every volume chart downstream.
    const bench = STARTER_CATALOGUE.find((entry) => entry.id === 'bench-press');
    expect(bench?.muscles.filter((share) => share.fraction === 1)).toHaveLength(1);
  });

  it('marks assisted work as assisted, so progress does not read as regression', () => {
    const assisted = STARTER_CATALOGUE.find((entry) => entry.id === 'assisted-pull-up');
    expect(assisted?.loadKind).toBe('assisted');
  });

  it('measures planks in time and carries in distance', () => {
    expect(STARTER_CATALOGUE.find((e) => e.id === 'plank')?.effortKind).toBe('duration');
    expect(STARTER_CATALOGUE.find((e) => e.id === 'farmers-carry')?.effortKind).toBe('distance');
  });

  it('converts to an ExerciseRef that carries the name and the split', () => {
    const entry = STARTER_CATALOGUE[0] as CatalogueEntry;
    const ref = toExerciseRef(entry);
    // Denormalised deliberately: history renders offline from one document, and a
    // catalogue rebuild must not rewrite what a lifter's log says they did.
    expect(ref.source).toBe('catalogue');
    expect(ref.name).toBe(entry.name);
    expect(ref.muscles).toEqual([...entry.muscles]);
    expect(ref.loadKind).toBe(entry.loadKind);
  });
});
