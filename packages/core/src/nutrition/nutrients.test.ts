import { describe, expect, it } from 'vitest';
import {
  addNutrients,
  atwaterDiscrepancy,
  energyFromMacros,
  hasAtwaterMismatch,
  macroEnergyShare,
  multiplyNutrients,
  roundTo,
  scaleNutrients,
  STORAGE_DECIMALS,
  subtractNutrients,
  toStorageResolution,
  zeroNutrients,
} from './nutrients.js';
import type { NutrientProfile } from './types.js';

/** USDA chicken breast, raw, per 100 g. Real numbers, so the arithmetic is checkable. */
const CHICKEN: NutrientProfile = {
  energyKcal: 165,
  proteinG: 31,
  carbsG: 0,
  fatG: 3.6,
  sodiumMg: 74,
  saturatedFatG: 1,
};

/** No fibre figure at all — the case that must not become "0 g of fibre". */
const NO_FIBRE: NutrientProfile = { energyKcal: 100, proteinG: 5, carbsG: 10, fatG: 4 };

describe('roundTo', () => {
  it('rounds half away from zero', () => {
    expect(roundTo(0.5, 0)).toBe(1);
    expect(roundTo(-0.5, 0)).toBe(-1);
    expect(roundTo(1.5, 0)).toBe(2);
    expect(roundTo(2.5, 0)).toBe(3); // not banker's rounding
  });

  it('is exact where naive float rounding is not', () => {
    expect(roundTo(1.005, 2)).toBe(1.01); // Math.round(1.005*100)/100 gives 1
    expect(roundTo(8.165, 2)).toBe(8.17);
    expect(roundTo(0.1 + 0.2, 4)).toBe(0.3);
  });

  it('normalises negative zero, which JSON round-trips badly', () => {
    expect(Object.is(roundTo(-0.00001, 2), 0)).toBe(true);
  });

  it('survives non-finite input rather than propagating NaN into a document', () => {
    expect(roundTo(Number.NaN, 2)).toBe(0);
    expect(roundTo(Number.POSITIVE_INFINITY, 2)).toBe(0);
  });
});

describe('scaleNutrients', () => {
  it('is the identity at 100 g', () => {
    expect(scaleNutrients(CHICKEN, 100)).toEqual(CHICKEN);
  });

  it('scales every present field linearly', () => {
    expect(scaleNutrients(CHICKEN, 150)).toEqual({
      energyKcal: 247.5,
      proteinG: 46.5,
      carbsG: 0,
      fatG: 5.4,
      sodiumMg: 111,
      saturatedFatG: 1.5,
    });
  });

  it('gives an all-zero profile at zero grams, keeping the fields that existed', () => {
    const scaled = scaleNutrients(CHICKEN, 0);
    expect(scaled.energyKcal).toBe(0);
    expect(scaled.sodiumMg).toBe(0);
    expect('fiberG' in scaled).toBe(false);
  });

  it('never invents an absent field', () => {
    expect('fiberG' in scaleNutrients(NO_FIBRE, 250)).toBe(false);
  });

  it('rejects a negative amount instead of producing negative food', () => {
    expect(() => scaleNutrients(CHICKEN, -1)).toThrow(RangeError);
    expect(() => scaleNutrients(CHICKEN, Number.NaN)).toThrow(RangeError);
  });
});

describe('multiplyNutrients', () => {
  it('multiplies an already-absolute profile', () => {
    expect(multiplyNutrients(CHICKEN, 2).energyKcal).toBe(330);
  });

  it('rejects a negative factor', () => {
    expect(() => multiplyNutrients(CHICKEN, -2)).toThrow(RangeError);
  });
});

describe('addNutrients — absent is not zero', () => {
  it('sums the required fields', () => {
    const sum = addNutrients(NO_FIBRE, NO_FIBRE);
    expect(sum).toMatchObject({ energyKcal: 200, proteinG: 10, carbsG: 20, fatG: 8 });
  });

  it('omits an optional field no contributor carried', () => {
    expect('fiberG' in addNutrients(NO_FIBRE, NO_FIBRE)).toBe(false);
    expect('sodiumMg' in addNutrients(NO_FIBRE, NO_FIBRE)).toBe(false);
  });

  it('includes an optional field as soon as one contributor carries it', () => {
    const sum = addNutrients(NO_FIBRE, { ...NO_FIBRE, fiberG: 3 });
    expect(sum.fiberG).toBe(3);
  });

  it('treats a contributor that omits the field as contributing nothing, not zero-weighting the total', () => {
    // Both foods have 3 g. One food with no figure must not drag the total down.
    const sum = addNutrients({ ...NO_FIBRE, fiberG: 3 }, NO_FIBRE, { ...NO_FIBRE, fiberG: 3 });
    expect(sum.fiberG).toBe(6);
  });

  it('returns a zero profile for no arguments', () => {
    expect(addNutrients()).toEqual(zeroNutrients());
  });

  it('does not drift over a full day at the 150-entry schema cap', () => {
    const entry = scaleNutrients(CHICKEN, 33.3);
    const day = addNutrients(...Array.from({ length: 150 }, () => entry));
    // Exact: each entry is already at storage resolution, so the sum is too.
    expect(day.energyKcal).toBeCloseTo(entry.energyKcal * 150, 6);
    expect(day.proteinG).toBeCloseTo(entry.proteinG * 150, 6);
  });
});

describe('subtractNutrients', () => {
  it('keeps a negative result, because "over target" is the interesting case', () => {
    const remaining = subtractNutrients(
      { energyKcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 },
      { energyKcal: 2300, proteinG: 120, carbsG: 260, fatG: 70 },
    );
    expect(remaining.energyKcal).toBe(-300);
    expect(remaining.proteinG).toBe(30);
    expect(remaining.fatG).toBe(-10);
  });

  it('keeps an optional field present when only one side has it', () => {
    const out = subtractNutrients({ ...NO_FIBRE, fiberG: 30 }, NO_FIBRE);
    expect(out.fiberG).toBe(30);
  });
});

describe('energyFromMacros', () => {
  it('applies the Atwater general factors', () => {
    expect(energyFromMacros({ energyKcal: 0, proteinG: 10, carbsG: 10, fatG: 10 })).toBe(170);
  });

  it('counts alcohol at 7 kcal/g, so a spirit does not appear to have calories from nowhere', () => {
    // 50 ml of 40% vodka ≈ 15.8 g ethanol ≈ 110 kcal, and no macros at all.
    const vodka: NutrientProfile = { energyKcal: 110, proteinG: 0, carbsG: 0, fatG: 0, alcoholG: 15.8 };
    expect(energyFromMacros(vodka)).toBeCloseTo(110.6, 1);
    expect(hasAtwaterMismatch(vodka)).toBe(false);
  });
});

describe('atwater consistency', () => {
  it('reports no discrepancy for a self-consistent food', () => {
    expect(atwaterDiscrepancy({ energyKcal: 170, proteinG: 10, carbsG: 10, fatG: 10 })).toBe(0);
  });

  it('flags a food whose stated energy disagrees with its macros by over 25%', () => {
    expect(hasAtwaterMismatch({ energyKcal: 100, proteinG: 10, carbsG: 10, fatG: 10 })).toBe(true);
  });

  it('does not flag a genuine zero-calorie drink', () => {
    expect(hasAtwaterMismatch({ energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 })).toBe(false);
  });
});

describe('macroEnergyShare', () => {
  it('splits by energy contribution, not by mass', () => {
    const share = macroEnergyShare({ energyKcal: 170, proteinG: 10, carbsG: 10, fatG: 10 });
    expect(share).not.toBeNull();
    expect(share?.protein).toBeCloseTo(40 / 170, 6);
    expect(share?.fat).toBeCloseTo(90 / 170, 6);
    expect((share?.protein ?? 0) + (share?.carbs ?? 0) + (share?.fat ?? 0)).toBeCloseTo(1, 9);
  });

  it('returns null rather than NaN for a zero-energy food', () => {
    expect(macroEnergyShare({ energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 })).toBeNull();
  });
});

describe('toStorageResolution', () => {
  it('bounds stored precision so float noise never reaches a document', () => {
    const noisy = toStorageResolution({ energyKcal: 0.1 + 0.2, proteinG: 1 / 3, carbsG: 0, fatG: 0 });
    expect(noisy.energyKcal).toBe(0.3);
    expect(noisy.proteinG).toBe(roundTo(1 / 3, STORAGE_DECIMALS));
    expect(String(noisy.proteinG)).toBe('0.3333');
  });
});
