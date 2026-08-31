import { describe, expect, it } from 'vitest';
import { scaleNutrients } from './nutrients.js';
import {
  computePortionNutrition,
  convertQuantityBetweenServings,
  DEFAULT_DENSITY_G_PER_ML,
  defaultServing,
  GRAM_SERVING,
  GRAMS_PER_OUNCE,
  GRAMS_PER_POUND,
  gramsForPortion,
  gramsToMillilitres,
  gramsToOunces,
  hasStatedServing,
  defaultPortion,
  HUNDRED_GRAM_SERVING,
  isPlausibleDensity,
  MILLILITRES_PER_US_CUP,
  MILLILITRES_PER_US_FLUID_OUNCE,
  MILLILITRES_PER_US_TABLESPOON,
  millilitresToGrams,
  ouncesToGrams,
  per100gFromPer100Ml,
  per100MlFromPer100g,
  quantityForGrams,
  rescalePortion,
  resolveDensity,
  servingsForFood,
  toCanonicalPer100g,
  usCupServing,
} from './portions.js';
import type { NutrientProfile, Serving } from './types.js';

/** Olive oil. Density 0.913 g/ml — the food that exposes a ml-treated-as-g bug. */
const OIL_DENSITY = 0.913;
/** Per 100 ml, as a volumetric dataset row would state it. */
const OIL_PER_100ML: NutrientProfile = {
  energyKcal: 807,
  proteinG: 0,
  carbsG: 0,
  fatG: 91.3,
  saturatedFatG: 12.6,
};

const SLICE: Serving = { name: 'slice', gramsPerServing: 28 };

describe('conversion factors are exact by definition, not rounded', () => {
  it('derives the ounce from the 1959 international pound', () => {
    expect(GRAMS_PER_POUND).toBe(0.45359237 * 1000);
    expect(GRAMS_PER_OUNCE * 16).toBeCloseTo(GRAMS_PER_POUND, 9);
  });

  it('uses the US customary fluid ounce, not the imperial one', () => {
    expect(MILLILITRES_PER_US_FLUID_OUNCE).toBeCloseTo(29.5735295625, 9);
    // The imperial fl oz is 28.4130625 ml. Confusing the two is a 4% error.
    expect(MILLILITRES_PER_US_FLUID_OUNCE).not.toBeCloseTo(28.4130625, 3);
  });

  it('keeps cup, tablespoon and teaspoon in exact proportion', () => {
    expect(MILLILITRES_PER_US_CUP / MILLILITRES_PER_US_TABLESPOON).toBeCloseTo(16, 9);
    expect(MILLILITRES_PER_US_CUP / MILLILITRES_PER_US_FLUID_OUNCE).toBeCloseTo(8, 9);
  });
});

describe('density handling', () => {
  it('accepts a plausible density and rejects an impossible one', () => {
    expect(isPlausibleDensity(0.913)).toBe(true);
    expect(isPlausibleDensity(0)).toBe(false);
    expect(isPlausibleDensity(9)).toBe(false);
    expect(isPlausibleDensity(Number.NaN)).toBe(false);
  });

  it('falls back to the default rather than throwing, so one bad row cannot break the log screen', () => {
    expect(resolveDensity(null)).toBe(DEFAULT_DENSITY_G_PER_ML);
    expect(resolveDensity(undefined)).toBe(DEFAULT_DENSITY_G_PER_ML);
    expect(resolveDensity(0)).toBe(DEFAULT_DENSITY_G_PER_ML);
    expect(resolveDensity(0.913)).toBe(0.913);
  });

  it('matches the datasets pipeline default, so a food does not change mass when edited', () => {
    // packages/datasets/src/schema.mjs → DEFAULT_DENSITY_G_PER_ML
    expect(DEFAULT_DENSITY_G_PER_ML).toBe(1.0);
  });
});

describe('volume ↔ mass', () => {
  it('converts by density in both directions', () => {
    expect(millilitresToGrams(100, OIL_DENSITY)).toBeCloseTo(91.3, 6);
    expect(gramsToMillilitres(91.3, OIL_DENSITY)).toBeCloseTo(100, 6);
  });

  it('round-trips', () => {
    const ml = 236.5882365;
    expect(gramsToMillilitres(millilitresToGrams(ml, OIL_DENSITY), OIL_DENSITY)).toBeCloseTo(ml, 3);
  });

  it('is the identity for water, which is exactly why a density bug hides', () => {
    expect(millilitresToGrams(250, 1.0)).toBe(250);
  });
});

describe('per-100 basis conversion', () => {
  it('converts a per-100 ml row to the canonical per-100 g form', () => {
    // 100 g of oil occupies 100/0.913 = 109.53 ml, so carries 807/0.913 kcal.
    const per100g = per100gFromPer100Ml(OIL_PER_100ML, OIL_DENSITY);
    expect(per100g.energyKcal).toBeCloseTo(807 / 0.913, 3);
    expect(per100g.fatG).toBeCloseTo(91.3 / 0.913, 3);
    expect(per100g.fatG).toBeCloseTo(100, 3); // pure fat, as it should be
  });

  it('round-trips through the inverse', () => {
    const back = per100MlFromPer100g(per100gFromPer100Ml(OIL_PER_100ML, OIL_DENSITY), OIL_DENSITY);
    expect(back.energyKcal).toBeCloseTo(OIL_PER_100ML.energyKcal, 3);
    expect(back.fatG).toBeCloseTo(OIL_PER_100ML.fatG, 3);
  });

  it('leaves a gram-basis row untouched', () => {
    const gramBasis: NutrientProfile = { energyKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 };
    expect(toCanonicalPer100g(gramBasis, 'g', null)).toEqual(gramBasis);
  });

  it('is a no-op for a volumetric row at density 1, and not otherwise', () => {
    expect(toCanonicalPer100g(OIL_PER_100ML, 'ml', 1).energyKcal).toBe(807);
    expect(toCanonicalPer100g(OIL_PER_100ML, 'ml', OIL_DENSITY).energyKcal).not.toBe(807);
  });
});

describe('the silent error this module exists to prevent', () => {
  it('a tablespoon of oil logged by volume is not a tablespoon of water', () => {
    const per100g = per100gFromPer100Ml(OIL_PER_100ML, OIL_DENSITY);
    const tbsp = usCupServing(OIL_DENSITY); // proportional; use a cup for a bigger signal
    const correct = computePortionNutrition({
      nutrientsPer100g: per100g,
      quantity: 1,
      serving: tbsp,
    });
    // The bug: assuming 1 ml = 1 g, i.e. logging the cup as 236.59 g.
    const wrong = scaleNutrients(per100g, MILLILITRES_PER_US_CUP);

    expect(correct.massG).toBeCloseTo(MILLILITRES_PER_US_CUP * OIL_DENSITY, 3);
    expect(wrong.energyKcal / correct.nutrients.energyKcal).toBeCloseTo(1 / OIL_DENSITY, 4);
    // ~9.5% overstatement on every oil entry, forever.
    expect(wrong.energyKcal - correct.nutrients.energyKcal).toBeGreaterThan(180);
  });
});

describe('gramsForPortion', () => {
  it('multiplies quantity by the serving mass', () => {
    expect(gramsForPortion(2, SLICE)).toBe(56);
    expect(gramsForPortion(0.5, SLICE)).toBe(14);
    expect(gramsForPortion(0, SLICE)).toBe(0);
  });

  it('rejects a negative quantity rather than clamping it out of sight', () => {
    expect(() => gramsForPortion(-1, SLICE)).toThrow(RangeError);
  });

  it('rejects a serving with no mass, which would make every portion zero', () => {
    expect(() => gramsForPortion(1, { name: 'x', gramsPerServing: 0 })).toThrow(RangeError);
  });
});

describe('switching serving holds the amount eaten constant', () => {
  it('turns 2 slices into 56 g, not 2 g', () => {
    expect(convertQuantityBetweenServings(2, SLICE, GRAM_SERVING)).toBe(56);
  });

  it('turns 56 g back into 2 slices', () => {
    expect(convertQuantityBetweenServings(56, GRAM_SERVING, SLICE)).toBe(2);
  });

  it('round-trips through an awkward unit', () => {
    const oz = { name: 'oz', gramsPerServing: GRAMS_PER_OUNCE };
    const back = convertQuantityBetweenServings(
      convertQuantityBetweenServings(3, SLICE, oz),
      oz,
      SLICE,
    );
    expect(back).toBeCloseTo(3, 3);
  });

  it('preserves mass across the switch', () => {
    const mass = gramsForPortion(1.5, SLICE);
    const q = convertQuantityBetweenServings(1.5, SLICE, HUNDRED_GRAM_SERVING);
    expect(gramsForPortion(q, HUNDRED_GRAM_SERVING)).toBeCloseTo(mass, 6);
  });
});

describe('rescalePortion', () => {
  it('re-derives from the per-100 g profile so repeated edits do not compound rounding', () => {
    const per100g: NutrientProfile = { energyKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 };
    let stepped = rescalePortion(per100g, SLICE, 0);
    for (let i = 1; i <= 12; i++) stepped = rescalePortion(per100g, SLICE, i);
    const typed = rescalePortion(per100g, SLICE, 12);
    // Tapping + twelve times must land exactly where typing 12 lands.
    expect(stepped).toEqual(typed);
  });
});

describe('quantityForGrams', () => {
  it('inverts the portion calculation', () => {
    expect(quantityForGrams(56, SLICE)).toBe(2);
  });

  it('rejects a zero-mass serving', () => {
    expect(() => quantityForGrams(56, { name: 'x', gramsPerServing: 0 })).toThrow(RangeError);
  });
});

describe('servingsForFood', () => {
  it('leads with the food’s own stated serving, because that is what the user is holding', () => {
    const list = servingsForFood({
      statedServingGrams: 28,
      statedServingLabel: '1 slice',
      basis: 'g',
    });
    expect(list[0]).toMatchObject({ name: 'slice', gramsPerServing: 28 });
    expect(defaultServing(list)).toBe(list[0]);
  });

  it('opens a whey protein on one scoop, not on 100 g of powder', () => {
    // The user's own test case. USDA states this one as `1 Scoop`; Open Food
    // Facts states it as `1 scoop (31 g)`. Both must land on the same serving.
    for (const label of ['1 Scoop', '1 scoop (31 g)']) {
      const list = servingsForFood({
        statedServingGrams: 31,
        statedServingLabel: label,
        basis: 'g',
      });
      expect(defaultServing(list)).toMatchObject({ name: 'scoop', gramsPerServing: 31 });
      expect(hasStatedServing(list)).toBe(true);
    }
  });

  it('keeps no wording at all when the label is only the mass again', () => {
    // Open Food Facts is full of these: `"33g"`, `"177.441g"`. Carried through
    // as a name they give `1 serving — 33g (33 g)` and an amount field reading
    // `1 · 33g`. There is nothing here the index has not already told us.
    for (const label of ['33g', '36 g', '177.441g', '250 ml']) {
      const list = servingsForFood({
        statedServingGrams: 33,
        statedServingLabel: label,
        basis: 'g',
      });
      expect(list[0]).toMatchObject({ name: 'serving', gramsPerServing: 33 });
    }
  });

  it('keeps a serving whose label carries its own count whole', () => {
    // "one serving is two tablespoons". Reducing this to a `tbsp` serving would
    // halve every amount the user logs, silently and forever.
    const list = servingsForFood({
      statedServingGrams: 32,
      statedServingLabel: '2 tbsp',
      basis: 'g',
    });
    expect(list[0]).toMatchObject({ name: '2 tbsp', gramsPerServing: 32 });
  });

  it('opens on 100 grams — never 1 gram — when the food states no serving', () => {
    // This is the bug the user hit: the sheet opened on `1 g` of chicken breast,
    // because grams led the list and the quantity was hard-coded to 1.
    const list = servingsForFood({ basis: 'g' });
    expect(hasStatedServing(list)).toBe(false);
    expect(defaultPortion(list)).toEqual({ serving: GRAM_SERVING, quantity: 100 });
  });

  it('opens a drink on 100 millilitres', () => {
    const list = servingsForFood({ basis: 'ml' });
    expect(list.map((s) => s.name)).toEqual(['ml', 'g']);
    expect(defaultPortion(list)).toMatchObject({ quantity: 100 });
    expect(defaultPortion(list).serving.name).toBe('ml');
  });

  it('opens a food that states a serving on exactly one of them', () => {
    const list = servingsForFood({
      statedServingGrams: 31,
      statedServingLabel: '1 scoop',
      basis: 'g',
    });
    expect(defaultPortion(list)).toEqual({ serving: list[0], quantity: 1 });
  });

  it('lets the packet’s own cup win over the one we would compute', () => {
    // A stated 240 g cup beside a computed 243.7 g cup, both reading "cup", is
    // a choice nobody can make. The packet is the better authority.
    const list = servingsForFood({
      statedServingGrams: 240,
      statedServingLabel: '1 cup',
      basis: 'ml',
      densityGPerMl: 1.03,
      imperial: true,
    });
    expect(list.filter((s) => s.name === 'cup')).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'cup', gramsPerServing: 240 });
  });

  it('offers volumetric units only for a liquid', () => {
    expect(servingsForFood({ basis: 'g' }).some((s) => s.name === 'ml')).toBe(false);
    expect(servingsForFood({ basis: 'ml' }).some((s) => s.name === 'ml')).toBe(true);
  });

  it('adds imperial units only on request, and cups only for a liquid', () => {
    const solid = servingsForFood({ basis: 'g', imperial: true }).map((s) => s.name);
    expect(solid).toContain('oz');
    expect(solid).not.toContain('cup');

    const liquid = servingsForFood({ basis: 'ml', imperial: true, densityGPerMl: OIL_DENSITY });
    expect(liquid.map((s) => s.name)).toContain('cup');
    expect(liquid.find((s) => s.name === 'cup')?.gramsPerServing).toBeCloseTo(
      MILLILITRES_PER_US_CUP * OIL_DENSITY,
      3,
    );
  });

  it('accepts a packet whose serving really is 100 g, without calling it "100 g"', () => {
    const list = servingsForFood({ statedServingGrams: 100, statedServingLabel: '100 g', basis: 'g' });
    expect(list.map((s) => s.name)).toEqual(['serving', 'g']);
    expect(defaultPortion(list)).toEqual({ serving: list[0], quantity: 1 });
  });

  it('gives a liquid serving its millilitre equivalent', () => {
    const list = servingsForFood({
      statedServingGrams: 240,
      statedServingLabel: '1 cup',
      basis: 'ml',
      densityGPerMl: 1.03, // milk
    });
    expect(list[0]?.millilitresPerServing).toBeCloseTo(240 / 1.03, 3);
  });
});

describe('imperial mass conversion', () => {
  it('round-trips ounces', () => {
    expect(gramsToOunces(ouncesToGrams(6))).toBeCloseTo(6, 3);
  });

  it('converts a 6 oz chicken breast to 170 g', () => {
    expect(Math.round(ouncesToGrams(6))).toBe(170);
  });
});

describe('computePortionNutrition', () => {
  it('produces the mass, the nutrients and the volume together', () => {
    const per100g: NutrientProfile = { energyKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 };
    const out = computePortionNutrition({ nutrientsPer100g: per100g, quantity: 2, serving: SLICE });
    expect(out.massG).toBe(56);
    expect(out.nutrients.energyKcal).toBeCloseTo(92.4, 4);
    expect(out.millilitresMl).toBeUndefined();
  });

  it('carries millilitres through for a volumetric serving', () => {
    const out = computePortionNutrition({
      nutrientsPer100g: { energyKcal: 42, proteinG: 3.4, carbsG: 5, fatG: 1 },
      quantity: 2,
      serving: { name: 'cup', gramsPerServing: 244, millilitresPerServing: 236.5882365 },
    });
    expect(out.massG).toBe(488);
    expect(out.millilitresMl).toBeCloseTo(473.176473, 4);
  });
});
