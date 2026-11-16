import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_CUSTOM_EXERCISES,
  listCustomExercises,
  removeCustomExercise,
  saveCustomExercise,
  toCatalogueEntry,
} from './customExercises.js';
import type { CustomExerciseDraft } from './customExercises.js';
import type { ExerciseId } from '@freeforever/data';

const KEY = 'ff.workout.custom.v1';

const draft: CustomExerciseDraft = {
  name: 'Jefferson Curl',
  muscle: 'lower_back',
  loadKind: 'external',
  effortKind: 'reps',
  equipment: 'other',
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('saving', () => {
  it('round-trips through storage', () => {
    const result = saveCustomExercise(draft);
    expect(result.ok).toBe(true);

    const listed = listCustomExercises();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe('Jefferson Curl');
    expect(listed[0]?.muscles[0]).toEqual({ muscle: 'lower_back', fraction: 1 });
  });

  it('trims the name and refuses one that is only whitespace', () => {
    expect(saveCustomExercise({ ...draft, name: '  Zercher Squat  ' })).toMatchObject({
      ok: true,
      entry: { name: 'Zercher Squat' },
    });
    expect(saveCustomExercise({ ...draft, name: '   ' })).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('caps the list so a runaway caller cannot fill the quota', () => {
    for (let i = 0; i < MAX_CUSTOM_EXERCISES; i += 1) {
      expect(saveCustomExercise({ ...draft, name: `Lift ${i}` }).ok).toBe(true);
    }
    expect(saveCustomExercise({ ...draft, name: 'One too many' })).toEqual({
      ok: false,
      reason: 'too-many',
    });
    expect(listCustomExercises()).toHaveLength(MAX_CUSTOM_EXERCISES);
  });
});

describe('ids', () => {
  it('cannot collide with a bundled catalogue id', () => {
    // Bundled ids are name slugs: `Ab_Crunch_Machine`, `3_4_Sit-Up`. None begin `cx-`,
    // and `exerciseKey` reserves `~` as the variant separator, so neither may appear.
    const id = toCatalogueEntry(draft, 'ignored' as ExerciseId).id;
    expect(id).toBe('ignored');

    const saved = saveCustomExercise(draft);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.entry.id).toMatch(/^cx-[a-z0-9]+-[a-z0-9]+$/);
    expect(saved.entry.id).not.toContain('~');
    // The id schema's own rule: URL-safe, 1-64 characters.
    expect(saved.entry.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('issues a different id to each entry, so history can never be re-pointed', () => {
    const first = saveCustomExercise({ ...draft, name: 'A' });
    const second = saveCustomExercise({ ...draft, name: 'B' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.entry.id).not.toBe(second.entry.id);
  });
});

describe('reading a damaged store', () => {
  /*
   * Each of these is a real shape `localStorage` can hold: a half-written value from a
   * tab killed mid-write, or a key an older or newer build wrote. The picker reads this
   * on every open, so a throw here is a white screen on the one control the lifter
   * opened to get unstuck.
   */
  it.each([
    ['invalid JSON', '{not json'],
    ['a JSON object rather than an array', '{"name":"x"}'],
    ['a JSON scalar', '42'],
  ])('degrades to empty on %s', (_label, raw) => {
    localStorage.setItem(KEY, raw);
    expect(listCustomExercises()).toEqual([]);
  });

  it('drops individual rows that are the wrong shape and keeps the good ones', () => {
    const good = toCatalogueEntry(draft, 'cx-good' as ExerciseId);
    localStorage.setItem(
      KEY,
      JSON.stringify([good, { id: 'cx-bad' }, null, { id: 'cx-nomuscles', name: 'x', muscles: [] }]),
    );
    const listed = listCustomExercises();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe('cx-good');
  });
});

describe('when storage refuses', () => {
  it('reports unwritable rather than appearing to succeed', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      // Safari private browsing and a full quota both throw here rather than returning.
      throw new DOMException('QuotaExceededError');
    });
    expect(saveCustomExercise(draft)).toEqual({ ok: false, reason: 'unwritable' });
  });

  it('degrades to an empty list rather than throwing on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    expect(() => listCustomExercises()).not.toThrow();
    expect(listCustomExercises()).toEqual([]);
  });
});

describe('removing', () => {
  it('drops it from the picker', () => {
    const saved = saveCustomExercise(draft);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    expect(removeCustomExercise(saved.entry.id)).toBe(true);
    expect(listCustomExercises()).toEqual([]);
  });

  it('leaves other entries alone', () => {
    const keep = saveCustomExercise({ ...draft, name: 'Keep' });
    const drop = saveCustomExercise({ ...draft, name: 'Drop' });
    expect(keep.ok && drop.ok).toBe(true);
    if (!keep.ok || !drop.ok) return;

    removeCustomExercise(drop.entry.id);
    const listed = listCustomExercises();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe('Keep');
  });
});
