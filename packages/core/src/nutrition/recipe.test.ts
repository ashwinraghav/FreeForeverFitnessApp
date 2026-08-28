import { describe, expect, it } from 'vitest';
import { scaleNutrients } from './nutrients.js';
import { computeRecipeTotals, servingScaleFactor } from './recipe.js';
import type { NutrientProfile } from './types.js';

const MINCE: NutrientProfile = { energyKcal: 250, proteinG: 26, carbsG: 0, fatG: 15 };
const TOMATO: NutrientProfile = { energyKcal: 32, proteinG: 1.6, carbsG: 7, fatG: 0.3, fiberG: 2.2 };
const OIL: NutrientProfile = { energyKcal: 884, proteinG: 0, carbsG: 0, fatG: 100 };

const ingredients = [
  { massG: 500, nutrients: scaleNutrients(MINCE, 500) },
  { massG: 400, nutrients: scaleNutrients(TOMATO, 400) },
  { massG: 30, nutrients: scaleNutrients(OIL, 30) },
];

describe('computeRecipeTotals', () => {
  it('sums the ingredients into a total', () => {
    const out = computeRecipeTotals({ ingredients, servings: 4 });
    expect(out.totalMassG).toBe(930);
    expect(out.total.energyKcal).toBeCloseTo(250 * 5 + 32 * 4 + 884 * 0.3, 3);
  });

  it('divides the total into servings', () => {
    const out = computeRecipeTotals({ ingredients, servings: 4 });
    expect(out.nutrientsPerServing.energyKcal).toBeCloseTo(out.total.energyKcal / 4, 3);
    expect(out.nutrientsPerServing.proteinG).toBeCloseTo(out.total.proteinG / 4, 3);
  });

  it('uses raw mass for the per-100 g figure when nothing was weighed after cooking', () => {
    const out = computeRecipeTotals({ ingredients, servings: 4 });
    expect(out.usedCookedMass).toBe(false);
    expect(out.basisMassG).toBe(930);
    expect(out.nutrientsPer100g.energyKcal).toBeCloseTo((out.total.energyKcal / 930) * 100, 3);
  });

  it('uses cooked mass when the user weighed the finished dish', () => {
    // A stew that reduced from 930 g to 700 g is denser in everything.
    const raw = computeRecipeTotals({ ingredients, servings: 4 });
    const cooked = computeRecipeTotals({ ingredients, servings: 4, cookedMassG: 700 });

    expect(cooked.usedCookedMass).toBe(true);
    expect(cooked.basisMassG).toBe(700);
    expect(cooked.nutrientsPer100g.energyKcal / raw.nutrientsPer100g.energyKcal).toBeCloseTo(
      930 / 700,
      3,
    );
  });

  it('leaves the total and the per-serving figures untouched by cooking loss', () => {
    // Water leaves; energy does not. Only the per-100 g density changes.
    const raw = computeRecipeTotals({ ingredients, servings: 4 });
    const cooked = computeRecipeTotals({ ingredients, servings: 4, cookedMassG: 700 });
    expect(cooked.total).toEqual(raw.total);
    expect(cooked.nutrientsPerServing).toEqual(raw.nutrientsPerServing);
  });

  it('ignores an implausible cooked mass rather than corrupting the recipe', () => {
    const out = computeRecipeTotals({ ingredients, servings: 4, cookedMassG: 0 });
    expect(out.usedCookedMass).toBe(false);
    expect(out.basisMassG).toBe(930);
  });

  it('propagates an optional nutrient only one ingredient carried', () => {
    const out = computeRecipeTotals({ ingredients, servings: 4 });
    expect(out.total.fiberG).toBeCloseTo(2.2 * 4, 3);
  });

  it('handles an empty ingredient list without dividing by zero', () => {
    const out = computeRecipeTotals({ ingredients: [], servings: 2 });
    expect(out.totalMassG).toBe(0);
    expect(out.nutrientsPer100g.energyKcal).toBe(0);
  });

  it('rejects a non-positive serving count', () => {
    expect(() => computeRecipeTotals({ ingredients, servings: 0 })).toThrow(RangeError);
    expect(() => computeRecipeTotals({ ingredients, servings: -1 })).toThrow(RangeError);
  });

  it('round-trips: logging every serving of a recipe equals eating the whole thing', () => {
    const servings = 4;
    const out = computeRecipeTotals({ ingredients, servings });
    const eatenAll = out.nutrientsPerServing.energyKcal * servings;
    expect(eatenAll).toBeCloseTo(out.total.energyKcal, 2);
  });
});

describe('servingScaleFactor', () => {
  it('doubles a recipe', () => {
    expect(servingScaleFactor(4, 8)).toBe(2);
  });

  it('halves one', () => {
    expect(servingScaleFactor(4, 2)).toBe(0.5);
  });

  it('rejects a non-positive source', () => {
    expect(() => servingScaleFactor(0, 4)).toThrow(RangeError);
  });
});
