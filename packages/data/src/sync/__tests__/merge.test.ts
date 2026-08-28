import { describe, expect, it } from 'vitest';
import {
  mergeHabitDays,
  mergeNutritionDays,
  mergePersonalRecords,
} from '../merge.js';
import { statesEqual } from '../runner.js';
import { makeHabitDay, makeNutritionDay, makePersonalRecord } from './fixtures.js';

describe('mergeNutritionDays', () => {
  const local = makeNutritionDay({
    localDate: '2026-08-24',
    meals: [
      { id: 'shared', entries: [{ id: 'a', energyKcal: 100 }, { id: 'localOnly', energyKcal: 200 }] },
      { id: 'localMeal', entries: [{ id: 'b', energyKcal: 300 }] },
    ],
  });
  const server = makeNutritionDay({
    localDate: '2026-08-24',
    meals: [
      { id: 'shared', entries: [{ id: 'a', energyKcal: 100 }, { id: 'serverOnly', energyKcal: 400 }] },
      { id: 'serverMeal', entries: [{ id: 'c', energyKcal: 500 }] },
    ],
  });

  it('unions meals and entries by id — nobody loses a logged meal', () => {
    const merged = mergeNutritionDays(local, server);
    expect(merged.meals.map((meal) => meal.id).sort()).toEqual(['localMeal', 'serverMeal', 'shared']);
    const shared = merged.meals.find((meal) => meal.id === 'shared');
    expect(shared?.entries.map((entry) => entry.id).sort()).toEqual(['a', 'localOnly', 'serverOnly']);
  });

  it('recomputes totals from the union instead of double-counting', () => {
    const merged = mergeNutritionDays(local, server);
    // a=100 (once, though both sides had it), localOnly=200, serverOnly=400, b=300, c=500
    expect(merged.totals.energyKcal).toBe(1500);
    expect(merged.entryCount).toBe(5);
  });

  it('is idempotent: merging a day with itself changes nothing that matters', () => {
    const merged = mergeNutritionDays(local, local);
    expect(merged.totals.energyKcal).toBe(local.totals.energyKcal);
    expect(merged.entryCount).toBe(local.entryCount);
  });
});

describe('mergeHabitDays', () => {
  it('an answered entry beats a pending one, regardless of side', () => {
    const local = makeHabitDay({
      localDate: '2026-08-24',
      entries: [
        { habitId: 'water', status: 'pending' },
        { habitId: 'steps', status: 'done' },
      ],
    });
    const server = makeHabitDay({
      localDate: '2026-08-24',
      entries: [
        { habitId: 'water', status: 'done' },
        { habitId: 'mobility', status: 'skipped' },
      ],
    });
    const merged = mergeHabitDays(local, server);
    const byId = new Map<string, string>(
      merged.entries.map((entry) => [entry.habitId, entry.status]),
    );
    expect(byId.get('water')).toBe('done'); // server's answer wins over local pending
    expect(byId.get('steps')).toBe('done'); // local-only preserved
    expect(byId.get('mobility')).toBe('skipped'); // server-only preserved
  });
});

describe('mergePersonalRecords', () => {
  const a = makePersonalRecord({
    id: 'bench_press',
    achievements: [
      { type: 'heaviest_weight', value: 100, achievedAt: 1_787_000_000_000, achievedOn: '2026-08-01', workoutId: 'w1' },
      { type: 'best_e1rm', value: 120, achievedAt: 1_787_000_000_000, achievedOn: '2026-08-01', workoutId: 'w1' },
    ],
  });
  const b = makePersonalRecord({
    id: 'bench_press',
    achievements: [
      { type: 'heaviest_weight', value: 105, achievedAt: 1_787_100_000_000, achievedOn: '2026-08-02', workoutId: 'w2' },
    ],
  });

  it('is a join: higher value wins per type, histories union', () => {
    const merged = mergePersonalRecords(a, b);
    expect(merged.current['heaviest_weight']?.value).toBe(105);
    expect(merged.current['best_e1rm']?.value).toBe(120); // only a had it; survives
    expect(merged.history).toHaveLength(3);
  });

  it('is commutative and idempotent (offline devices converge in any order)', () => {
    const ab = mergePersonalRecords(a, b);
    const ba = mergePersonalRecords(b, a);
    const strip = (record: typeof ab): unknown => ({
      current: record.current,
      repMaxKgByReps: record.repMaxKgByReps,
      history: record.history,
      lastAchievedOn: record.lastAchievedOn ?? null,
    });
    expect(statesEqual(strip(ab), strip(ba))).toBe(true);
    expect(statesEqual(strip(mergePersonalRecords(ab, ab)), strip(ab))).toBe(true);
    expect(statesEqual(strip(mergePersonalRecords(ab, b)), strip(ab))).toBe(true);
  });
});
