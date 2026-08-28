import { describe, expect, it } from 'vitest';
import {
  consumedSplit,
  energyRemainingKcal,
  macroProgress,
  rollUpDay,
  rollUpMeal,
  summariseDay,
  totalMassG,
  type MealLike,
} from './day.js';
import { addNutrients, scaleNutrients } from './nutrients.js';
import type { MacroTargetValues, NutrientProfile } from './types.js';

const CHICKEN: NutrientProfile = { energyKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6, sodiumMg: 74 };
const RICE: NutrientProfile = { energyKcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3, fiberG: 0.4 };
const OIL: NutrientProfile = { energyKcal: 884, proteinG: 0, carbsG: 0, fatG: 100 };

function entry(per100: NutrientProfile, grams: number) {
  return { massG: grams, nutrients: scaleNutrients(per100, grams) };
}

function mealOf(...entries: ReturnType<typeof entry>[]): MealLike {
  return { entries, totals: rollUpMeal(entries) };
}

describe('roll-up consistency', () => {
  it('makes the day total equal the sum of the meals, which equals the sum of the entries', () => {
    const lunch = mealOf(entry(CHICKEN, 180), entry(RICE, 250));
    const dinner = mealOf(entry(CHICKEN, 150), entry(RICE, 200), entry(OIL, 14));
    const day = rollUpDay([lunch, dinner]);

    const everyEntry = [...lunch.entries, ...dinner.entries];
    const direct = addNutrients(...everyEntry.map((e) => e.nutrients));

    expect(day.totals).toEqual(direct);
    expect(day.entryCount).toBe(5);
  });

  it('is an empty profile for an empty day, not a missing one', () => {
    expect(rollUpDay([])).toEqual({
      totals: { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      entryCount: 0,
    });
    expect(rollUpMeal([])).toEqual({ energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });

  it('carries an optional nutrient up from a single entry that had it', () => {
    const day = rollUpDay([mealOf(entry(CHICKEN, 100), entry(RICE, 100))]);
    expect(day.totals.fiberG).toBeCloseTo(0.4, 4); // only rice had a figure
    expect(day.totals.sodiumMg).toBeCloseTo(74, 4); // only chicken had one
  });

  it('reports no figure for a nutrient nothing in the day carried', () => {
    const day = rollUpDay([mealOf(entry(OIL, 20))]);
    expect('fiberG' in day.totals).toBe(false);
    expect('sodiumMg' in day.totals).toBe(false);
  });

  it('sums mass separately from nutrients', () => {
    expect(totalMassG([mealOf(entry(CHICKEN, 180), entry(RICE, 250))])).toBe(430);
  });
});

describe('macroProgress', () => {
  it('reports the fraction of a target consumed', () => {
    const p = macroProgress(1200, 2400);
    expect(p).toMatchObject({ consumed: 1200, target: 2400, remaining: 1200, fraction: 0.5, overBy: 0, isOver: false });
  });

  it('clamps the fraction at 1 and carries the excess separately', () => {
    const p = macroProgress(3000, 2400);
    expect(p.fraction).toBe(1); // so the ring does not wrap and read as 25%
    expect(p.overBy).toBe(600);
    expect(p.remaining).toBe(-600);
    expect(p.isOver).toBe(true);
  });

  it('treats exactly on target as not over', () => {
    expect(macroProgress(2400, 2400).isOver).toBe(false);
    expect(macroProgress(2400, 2400).fraction).toBe(1);
  });

  it('returns zero, not NaN or Infinity, when no target is set', () => {
    const p = macroProgress(1500, 0);
    expect(p.fraction).toBe(0);
    expect(Number.isFinite(p.fraction)).toBe(true);
    expect(p.isOver).toBe(false); // a user with no target has not failed at anything
  });

  it('handles a nonsense target defensively', () => {
    expect(macroProgress(100, Number.NaN).fraction).toBe(0);
    expect(macroProgress(100, -50).fraction).toBe(0);
  });
});

describe('summariseDay', () => {
  const target: MacroTargetValues = {
    energyKcal: 2400,
    proteinG: 160,
    carbsG: 260,
    fatG: 80,
    fiberG: 34,
    waterMl: 2800,
  };

  it('produces a row per macro against the day’s target', () => {
    const totals = rollUpDay([mealOf(entry(CHICKEN, 200), entry(RICE, 300))]).totals;
    const s = summariseDay({ totals, target, waterMl: 1000 });
    expect(s.energy.target).toBe(2400);
    expect(s.protein.consumed).toBeCloseTo(31 * 2 + 2.7 * 3, 3);
    expect(s.water?.consumed).toBe(1000);
    expect(s.fiber?.target).toBe(34);
  });

  it('omits the fibre and water rows when the target sets none', () => {
    const s = summariseDay({
      totals: rollUpDay([mealOf(entry(CHICKEN, 200))]).totals,
      target: { energyKcal: 2400, proteinG: 160, carbsG: 260, fatG: 80 },
      waterMl: 500,
    });
    expect(s.fiber).toBeNull();
    expect(s.water).toBeNull();
  });

  it('works with no target at all, rather than throwing on the home screen', () => {
    const s = summariseDay({
      totals: rollUpDay([mealOf(entry(CHICKEN, 200))]).totals,
      target: undefined,
      waterMl: 0,
    });
    expect(s.energy.target).toBe(0);
    expect(s.energy.fraction).toBe(0);
    expect(s.split).not.toBeNull();
  });
});

describe('consumedSplit', () => {
  it('divides consumed energy between the macros', () => {
    const split = consumedSplit({ energyKcal: 1000, proteinG: 50, carbsG: 100, fatG: 40 });
    expect(split?.protein).toBeCloseTo(0.2, 6);
    expect(split?.carbs).toBeCloseTo(0.4, 6);
    expect(split?.fat).toBeCloseTo(0.36, 6);
  });

  it('uses the stated energy, so the split agrees with the number on the ring', () => {
    // A day whose foods disagree with their own macros still sums to its own total.
    const split = consumedSplit({ energyKcal: 2000, proteinG: 100, carbsG: 100, fatG: 100 });
    expect(split?.protein).toBeCloseTo(400 / 2000, 6);
  });

  it('is null for an empty day', () => {
    expect(consumedSplit({ energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 })).toBeNull();
  });
});

describe('energyRemainingKcal', () => {
  it('floors at zero for the "you can still eat" affordance', () => {
    const totals: NutrientProfile = { energyKcal: 2600, proteinG: 0, carbsG: 0, fatG: 0 };
    expect(energyRemainingKcal(totals, { energyKcal: 2400, proteinG: 0, carbsG: 0, fatG: 0 })).toBe(0);
  });

  it('is zero when there is no target', () => {
    expect(energyRemainingKcal({ energyKcal: 500, proteinG: 0, carbsG: 0, fatG: 0 })).toBe(0);
  });
});
