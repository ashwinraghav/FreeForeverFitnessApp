import { describe, expect, it } from 'vitest';
import {
  addNutrients,
  MAX_ENTRIES_PER_DAY,
  MAX_ENTRIES_PER_MEAL,
  rollUpMeal,
  scaleNutrients,
  type NutrientProfile,
  type Serving,
} from '@freeforever/core/src/nutrition/index.js';
import {
  addWater,
  checkCapacity,
  copyMeal,
  logAgain,
  logFood,
  logSavedMeal,
  moveEntry,
  quickAdd,
  rankRecents,
  recentScore,
  RECENCY_HALF_LIFE_MS,
  removeEntry,
  saveMealTemplate,
  setEntryQuantity,
  toggleFavourite,
  touchRecent,
} from './log.js';
import { EMPTY_STATE, type FoodSnapshot, type NutritionState, type RecentFood } from './types.js';

const CHICKEN: NutrientProfile = { energyKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6, sodiumMg: 74 };
const RICE: NutrientProfile = { energyKcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3, fiberG: 0.4 };

const SLICE: Serving = { name: 'slice', gramsPerServing: 28 };
const GRAM: Serving = { name: 'g', gramsPerServing: 1 };

function snapshot(key: string, name: string, per100 = CHICKEN): FoodSnapshot {
  return {
    key,
    ref: { source: 'bundled', foodId: key, name },
    nutrientsPer100g: per100,
    servings: [SLICE, GRAM],
  };
}

const DATE = '2026-08-28';
const TZ = 60;

function log(
  state: NutritionState,
  over: Partial<Parameters<typeof logFood>[1]> = {},
): NutritionState {
  return logFood(state, {
    date: DATE,
    tzOffsetMinutes: TZ,
    slot: 'lunch',
    snapshot: snapshot('core:1', 'Chicken breast'),
    quantity: 2,
    serving: SLICE,
    entryId: 'e1',
    now: 1_700_000_000_000,
    ...over,
  });
}

describe('logFood', () => {
  it('creates the day and the meal on the first entry', () => {
    const state = log(EMPTY_STATE);
    const day = state.days[DATE];
    expect(day?.localDate).toBe(DATE);
    expect(day?.tzOffsetMinutes).toBe(TZ);
    expect(day?.meals).toHaveLength(1);
    expect(day?.meals[0]?.slot).toBe('lunch');
    expect(day?.entryCount).toBe(1);
  });

  it('stores the amount eaten in grams and the nutrients already multiplied out', () => {
    const entry = log(EMPTY_STATE).days[DATE]?.meals[0]?.entries[0];
    expect(entry?.massG).toBe(56);
    expect(entry?.nutrients).toEqual(scaleNutrients(CHICKEN, 56));
    // Not a pointer into the index — the numbers travel with the entry, so a
    // rebuilt index never rewrites what someone ate last March.
    expect(entry?.nutrients.energyKcal).toBeCloseTo(92.4, 4);
  });

  it('keeps day totals equal to the sum of every entry, always', () => {
    let state = log(EMPTY_STATE);
    state = log(state, { entryId: 'e2', slot: 'dinner', snapshot: snapshot('core:2', 'Rice', RICE), quantity: 250, serving: GRAM });
    state = log(state, { entryId: 'e3', slot: 'lunch', quantity: 1 });

    const day = state.days[DATE];
    const everyEntry = day?.meals.flatMap((m) => m.entries) ?? [];
    expect(everyEntry).toHaveLength(3);
    expect(day?.totals).toEqual(addNutrients(...everyEntry.map((e) => e.nutrients)));
    for (const meal of day?.meals ?? []) {
      expect(meal.totals).toEqual(rollUpMeal(meal.entries));
    }
  });

  it('adds to the existing meal rather than creating a second one', () => {
    const state = log(log(EMPTY_STATE), { entryId: 'e2' });
    expect(state.days[DATE]?.meals).toHaveLength(1);
    expect(state.days[DATE]?.meals[0]?.entries).toHaveLength(2);
  });

  it('gives entries increasing sort keys so their order is stable', () => {
    const state = log(log(log(EMPTY_STATE), { entryId: 'e2' }), { entryId: 'e3' });
    const keys = state.days[DATE]?.meals[0]?.entries.map((e) => e.sortKey) ?? [];
    expect(keys).toHaveLength(3);
    expect([...keys].sort()).toEqual(keys);
  });

  it('orders meals by when they are eaten, not by when they were logged', () => {
    let state = log(EMPTY_STATE, { slot: 'dinner', entryId: 'd1' });
    state = log(state, { slot: 'breakfast', entryId: 'b1' });
    expect(state.days[DATE]?.meals.map((m) => m.slot)).toEqual(['breakfast', 'dinner']);
  });

  it('refuses to exceed the per-meal cap', () => {
    let state = EMPTY_STATE;
    for (let i = 0; i < MAX_ENTRIES_PER_MEAL; i++) state = log(state, { entryId: `e${i}`, slot: 'lunch' });
    expect(state.days[DATE]?.meals[0]?.entries).toHaveLength(MAX_ENTRIES_PER_MEAL);
    expect(checkCapacity(state, DATE, 'lunch')).toBe('meal_entry_cap');
    expect(log(state, { entryId: 'overflow', slot: 'lunch' })).toBe(state);
    // A different meal still has room — the cap is per meal, not per day yet.
    expect(checkCapacity(state, DATE, 'dinner')).toBeNull();
  });

  it('refuses to exceed the schema day cap rather than writing a document that will be rejected', () => {
    // Three full meals is exactly the 150-entry day cap; the per-meal cap of 50
    // binds first within any one meal, which is why this spreads across slots.
    let state = EMPTY_STATE;
    for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
      for (let i = 0; i < MAX_ENTRIES_PER_MEAL; i++) {
        state = log(state, { entryId: `${slot}${i}`, slot });
      }
    }
    expect(state.days[DATE]?.entryCount).toBe(MAX_ENTRIES_PER_DAY);
    expect(checkCapacity(state, DATE, 'snack')).toBe('day_entry_cap');
    expect(log(state, { entryId: 'overflow', slot: 'snack' })).toBe(state);
  });
});

describe('the two-tap repeat path', () => {
  it('records everything needed to log again: nutrients, portion and meal', () => {
    const state = log(EMPTY_STATE, { slot: 'breakfast', quantity: 3 });
    const recent = state.recents[0];
    expect(recent?.snapshot.key).toBe('core:1');
    expect(recent?.lastQuantity).toBe(3);
    expect(recent?.lastServing).toEqual(SLICE);
    expect(recent?.lastSlot).toBe('breakfast');
    expect(recent?.logCount).toBe(1);
    // The nutrients travel with the recent, so the repeat needs no index read.
    expect(recent?.snapshot.nutrientsPer100g).toEqual(CHICKEN);
  });

  it('reproduces the previous entry exactly from one call and no lookup', () => {
    const first = log(EMPTY_STATE, { slot: 'breakfast', quantity: 3 });
    const second = logAgain(first, {
      key: 'core:1',
      date: '2026-08-29',
      tzOffsetMinutes: TZ,
      entryId: 'again',
      now: 1_700_100_000_000,
    });

    const original = first.days[DATE]?.meals[0]?.entries[0];
    const repeat = second.days['2026-08-29']?.meals[0]?.entries[0];

    expect(repeat?.quantity).toBe(original?.quantity);
    expect(repeat?.serving).toEqual(original?.serving);
    expect(repeat?.massG).toBe(original?.massG);
    expect(repeat?.nutrients).toEqual(original?.nutrients);
    expect(second.days['2026-08-29']?.meals[0]?.slot).toBe('breakfast');
  });

  it('works for a food the index no longer contains', () => {
    // The whole point of the fat snapshot: nothing here consults a catalogue.
    const state = log(EMPTY_STATE);
    const repeated = logAgain(state, {
      key: 'core:1',
      date: DATE,
      tzOffsetMinutes: TZ,
      entryId: 'again',
      now: 1,
    });
    expect(repeated.days[DATE]?.entryCount).toBe(2);
  });

  it('counts up rather than duplicating when the same food is logged twice', () => {
    const state = log(log(EMPTY_STATE), { entryId: 'e2', quantity: 5 });
    expect(state.recents).toHaveLength(1);
    expect(state.recents[0]?.logCount).toBe(2);
    expect(state.recents[0]?.lastQuantity).toBe(5);
  });

  it('does nothing for a key that is not in recents', () => {
    expect(logAgain(EMPTY_STATE, { key: 'nope', date: DATE, tzOffsetMinutes: TZ, entryId: 'x', now: 1 })).toBe(
      EMPTY_STATE,
    );
  });

  it('is undoable by removing the entry it created', () => {
    const before = log(EMPTY_STATE);
    const after = logAgain(before, { key: 'core:1', date: DATE, tzOffsetMinutes: TZ, entryId: 'undo-me', now: 2 });
    const undone = removeEntry(after, { date: DATE, entryId: 'undo-me' });
    expect(undone.days[DATE]?.totals).toEqual(before.days[DATE]?.totals);
    expect(undone.days[DATE]?.entryCount).toBe(1);
  });
});

describe('recents ranking', () => {
  const base: RecentFood = {
    snapshot: snapshot('a', 'A'),
    lastQuantity: 1,
    lastServing: SLICE,
    lastSlot: 'lunch',
    logCount: 1,
    lastLoggedAt: 0,
  };

  it('decays by half over the half-life', () => {
    const now = RECENCY_HALF_LIFE_MS;
    expect(recentScore({ ...base, lastLoggedAt: now }, now)).toBeCloseTo(
      recentScore({ ...base, lastLoggedAt: 0 }, now) * 2,
      6,
    );
  });

  it('keeps a daily staple above a one-off logged more recently', () => {
    const now = 30 * 24 * 60 * 60 * 1000;
    const staple: RecentFood = {
      ...base,
      snapshot: snapshot('staple', 'Yoghurt'),
      logCount: 60,
      lastLoggedAt: now - 24 * 60 * 60 * 1000,
    };
    const oneOff: RecentFood = {
      ...base,
      snapshot: snapshot('oneoff', 'Restaurant dish'),
      logCount: 1,
      lastLoggedAt: now - 60 * 60 * 1000,
    };
    expect(rankRecents([oneOff, staple], now)[0]?.snapshot.key).toBe('staple');
  });

  it('keeps a new daily habit above a food abandoned a year ago', () => {
    const now = 400 * 24 * 60 * 60 * 1000;
    const abandoned: RecentFood = { ...base, snapshot: snapshot('old', 'Old'), logCount: 300, lastLoggedAt: 0 };
    const habit: RecentFood = { ...base, snapshot: snapshot('new', 'New'), logCount: 5, lastLoggedAt: now };
    expect(rankRecents([abandoned, habit], now)[0]?.snapshot.key).toBe('new');
  });

  it('is deterministic for equal scores', () => {
    const a = { ...base, snapshot: snapshot('a', 'A') };
    const b = { ...base, snapshot: snapshot('b', 'B') };
    expect(rankRecents([b, a], 0).map((r) => r.snapshot.key)).toEqual(['a', 'b']);
  });

  it('refreshes the snapshot, so an edited custom food does not log stale nutrients', () => {
    const edited = { ...snapshot('a', 'A'), nutrientsPer100g: RICE };
    const out = touchRecent([base], { snapshot: edited, quantity: 1, serving: SLICE, slot: 'lunch', now: 1 });
    expect(out[0]?.snapshot.nutrientsPer100g).toEqual(RICE);
  });

  it('caps the list and drops the least useful entry, not merely the oldest', () => {
    let recents: RecentFood[] = [];
    for (let i = 0; i < 80; i++) {
      recents = touchRecent(recents, {
        snapshot: snapshot(`f${i}`, `Food ${i}`),
        quantity: 1,
        serving: SLICE,
        slot: 'lunch',
        now: i * 1000,
      });
    }
    expect(recents.length).toBeLessThanOrEqual(60);
  });
});

describe('editing a logged entry', () => {
  it('re-derives from the per-100 g profile rather than rescaling rounded numbers', () => {
    const state = log(EMPTY_STATE, { quantity: 1 });
    let stepped = state;
    for (let q = 2; q <= 12; q++) {
      stepped = setEntryQuantity(stepped, { date: DATE, entryId: 'e1', quantity: q, nutrientsPer100g: CHICKEN });
    }
    const typed = setEntryQuantity(state, { date: DATE, entryId: 'e1', quantity: 12, nutrientsPer100g: CHICKEN });
    expect(stepped.days[DATE]?.meals[0]?.entries[0]?.nutrients).toEqual(
      typed.days[DATE]?.meals[0]?.entries[0]?.nutrients,
    );
  });

  it('recomputes the day totals after an edit', () => {
    const state = setEntryQuantity(log(EMPTY_STATE), {
      date: DATE,
      entryId: 'e1',
      quantity: 4,
      nutrientsPer100g: CHICKEN,
    });
    expect(state.days[DATE]?.totals.energyKcal).toBeCloseTo(scaleNutrients(CHICKEN, 112).energyKcal, 4);
  });

  it('rejects a negative quantity instead of storing negative food', () => {
    const state = log(EMPTY_STATE);
    expect(setEntryQuantity(state, { date: DATE, entryId: 'e1', quantity: -1, nutrientsPer100g: CHICKEN })).toBe(state);
  });

  it('drops a meal once its last entry goes, rather than leaving a zero row', () => {
    const state = removeEntry(log(EMPTY_STATE), { date: DATE, entryId: 'e1' });
    expect(state.days[DATE]?.meals).toHaveLength(0);
    expect(state.days[DATE]?.totals.energyKcal).toBe(0);
  });

  it('moves an entry between meals without changing the day total', () => {
    const before = log(EMPTY_STATE);
    const after = moveEntry(before, { date: DATE, entryId: 'e1', toSlot: 'dinner' });
    expect(after.days[DATE]?.meals[0]?.slot).toBe('dinner');
    expect(after.days[DATE]?.totals).toEqual(before.days[DATE]?.totals);
  });
});

describe('quick add', () => {
  it('logs bare macros with no food behind them', () => {
    const state = quickAdd(EMPTY_STATE, {
      date: DATE,
      tzOffsetMinutes: TZ,
      slot: 'dinner',
      nutrients: { energyKcal: 800, proteinG: 30, carbsG: 80, fatG: 35 },
      name: 'Lunch out',
      entryId: 'q1',
      now: 1,
    });
    const entry = state.days[DATE]?.meals[0]?.entries[0];
    expect(entry?.food.name).toBe('Lunch out');
    expect(entry?.nutrients.energyKcal).toBe(800);
    expect(state.days[DATE]?.totals.energyKcal).toBe(800);
  });

  it('does not pollute recents — a one-off is not a shortcut', () => {
    const state = quickAdd(EMPTY_STATE, {
      date: DATE,
      tzOffsetMinutes: TZ,
      slot: 'dinner',
      nutrients: { energyKcal: 800, proteinG: 30, carbsG: 80, fatG: 35 },
      entryId: 'q1',
      now: 1,
    });
    expect(state.recents).toHaveLength(0);
  });

  it('names an unnamed entry so it is recognisable in the log later', () => {
    const state = quickAdd(EMPTY_STATE, {
      date: DATE,
      tzOffsetMinutes: TZ,
      slot: 'other',
      nutrients: { energyKcal: 200, proteinG: 0, carbsG: 0, fatG: 0 },
      entryId: 'q1',
      now: 1,
    });
    expect(state.days[DATE]?.meals[0]?.entries[0]?.food.name).toBe('Quick add');
  });
});

describe('meal reuse', () => {
  function lunchOfTwo(): NutritionState {
    let state = log(EMPTY_STATE);
    state = log(state, { entryId: 'e2', snapshot: snapshot('core:2', 'Rice', RICE), quantity: 200, serving: GRAM });
    return state;
  }

  it('copies a meal to another day with its nutrients intact', () => {
    const state = lunchOfTwo();
    const copied = copyMeal(state, {
      fromDate: DATE,
      fromSlot: 'lunch',
      toDate: '2026-08-29',
      toSlot: 'lunch',
      tzOffsetMinutes: TZ,
      entryIds: ['c1', 'c2'],
      now: 5,
    });
    expect(copied.days['2026-08-29']?.totals).toEqual(state.days[DATE]?.totals);
    expect(copied.days['2026-08-29']?.meals[0]?.entries).toHaveLength(2);
  });

  it('does not disturb the source day', () => {
    const state = lunchOfTwo();
    const copied = copyMeal(state, {
      fromDate: DATE, fromSlot: 'lunch', toDate: '2026-08-29', toSlot: 'dinner',
      tzOffsetMinutes: TZ, entryIds: ['c1', 'c2'], now: 5,
    });
    expect(copied.days[DATE]).toEqual(state.days[DATE]);
  });

  it('reproduces what was eaten, not what the catalogue now says about it', () => {
    const state = lunchOfTwo();
    const copied = copyMeal(state, {
      fromDate: DATE, fromSlot: 'lunch', toDate: '2026-08-29', toSlot: 'lunch',
      tzOffsetMinutes: TZ, entryIds: ['c1', 'c2'], now: 5,
    });
    const original = state.days[DATE]?.meals[0]?.entries ?? [];
    const copies = copied.days['2026-08-29']?.meals[0]?.entries ?? [];
    copies.forEach((copy, i) => expect(copy.nutrients).toEqual(original[i]?.nutrients));
  });

  it('saves a meal as a template and logs it again in one action', () => {
    const state = saveMealTemplate(lunchOfTwo(), { date: DATE, slot: 'lunch', name: 'Usual lunch', id: 't1', now: 3 });
    expect(state.savedMeals[0]?.name).toBe('Usual lunch');

    const logged = logSavedMeal(state, {
      savedMealId: 't1', date: '2026-08-30', tzOffsetMinutes: TZ, entryIds: ['s1', 's2'], now: 9,
    });
    expect(logged.days['2026-08-30']?.entryCount).toBe(2);
    expect(logged.days['2026-08-30']?.totals).toEqual(state.days[DATE]?.totals);
  });

  it('refuses a copy that would breach the day cap', () => {
    // Fill to one short of the day cap, spread so no single meal caps first.
    let state = lunchOfTwo(); // 2 entries in lunch
    for (const [slot, count] of [['breakfast', 50], ['dinner', 50], ['snack', 47]] as const) {
      for (let i = 0; i < count; i++) state = log(state, { entryId: `${slot}${i}`, slot });
    }
    expect(state.days[DATE]?.entryCount).toBe(MAX_ENTRIES_PER_DAY - 1);
    // Copying the 2-entry lunch would make 151.
    expect(copyMeal(state, {
      fromDate: DATE, fromSlot: 'lunch', toDate: DATE, toSlot: 'other',
      tzOffsetMinutes: TZ, entryIds: ['x1', 'x2'], now: 5,
    })).toBe(state);
  });
});

describe('water and favourites', () => {
  it('accumulates water and never goes negative', () => {
    let state = addWater(EMPTY_STATE, { date: DATE, tzOffsetMinutes: TZ, millilitres: 250 });
    state = addWater(state, { date: DATE, tzOffsetMinutes: TZ, millilitres: 250 });
    expect(state.days[DATE]?.waterMl).toBe(500);
    state = addWater(state, { date: DATE, tzOffsetMinutes: TZ, millilitres: -900 });
    expect(state.days[DATE]?.waterMl).toBe(0);
  });

  it('toggles a favourite on and off', () => {
    const on = toggleFavourite(EMPTY_STATE, 'core:1');
    expect(on.favourites).toEqual(['core:1']);
    expect(toggleFavourite(on, 'core:1').favourites).toEqual([]);
  });
});

describe('immutability', () => {
  it('never mutates the state it was given', () => {
    const before = log(EMPTY_STATE);
    const frozen = JSON.stringify(before);
    log(before, { entryId: 'e2' });
    removeEntry(before, { date: DATE, entryId: 'e1' });
    setEntryQuantity(before, { date: DATE, entryId: 'e1', quantity: 9, nutrientsPer100g: CHICKEN });
    expect(JSON.stringify(before)).toBe(frozen);
  });
});
