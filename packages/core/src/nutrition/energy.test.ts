import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_MULTIPLIERS,
  dailyEnergyDeltaForRate,
  estimateMaintenanceKcal,
  mifflinStJeorBmr,
  tdeeKcal,
  validateAge,
} from './energy.js';
import { KCAL_PER_KG_BODY_MASS, MAX_VALIDATED_AGE_YEARS, MIN_VALIDATED_AGE_YEARS } from './safety.js';
import type { ActivityLevel } from './types.js';

describe('mifflinStJeorBmr', () => {
  // BMR = 10·kg + 6.25·cm − 5·age + s,  s = +5 male, −161 female.
  it('matches the published equation for a male subject', () => {
    // 10(80) + 6.25(180) − 5(30) + 5 = 800 + 1125 − 150 + 5
    expect(mifflinStJeorBmr({ bodyweightKg: 80, heightCm: 180, ageYears: 30, biologicalSex: 'male' })).toBe(1780);
  });

  it('matches it for a female subject', () => {
    expect(
      mifflinStJeorBmr({ bodyweightKg: 60, heightCm: 165, ageYears: 35, biologicalSex: 'female' }),
    ).toBe(10 * 60 + 6.25 * 165 - 5 * 35 - 161);
  });

  it('uses the midpoint of the two constants for an unspecified sex', () => {
    const args = { bodyweightKg: 80, heightCm: 180, ageYears: 30 } as const;
    const male = mifflinStJeorBmr({ ...args, biologicalSex: 'male' });
    const female = mifflinStJeorBmr({ ...args, biologicalSex: 'female' });
    const unspecified = mifflinStJeorBmr({ ...args, biologicalSex: 'unspecified' });
    expect(unspecified).toBe((male + female) / 2);
  });

  it('responds to each input with the equation’s own coefficient', () => {
    const base = { bodyweightKg: 80, heightCm: 180, ageYears: 30, biologicalSex: 'male' } as const;
    expect(mifflinStJeorBmr({ ...base, bodyweightKg: 81 }) - mifflinStJeorBmr(base)).toBeCloseTo(10, 9);
    expect(mifflinStJeorBmr({ ...base, heightCm: 181 }) - mifflinStJeorBmr(base)).toBeCloseTo(6.25, 9);
    expect(mifflinStJeorBmr({ ...base, ageYears: 31 }) - mifflinStJeorBmr(base)).toBeCloseTo(-5, 9);
  });

  it('rejects impossible inputs rather than returning a plausible-looking number', () => {
    const ok = { bodyweightKg: 80, heightCm: 180, ageYears: 30, biologicalSex: 'male' } as const;
    expect(() => mifflinStJeorBmr({ ...ok, bodyweightKg: 0 })).toThrow(RangeError);
    expect(() => mifflinStJeorBmr({ ...ok, heightCm: -1 })).toThrow(RangeError);
    expect(() => mifflinStJeorBmr({ ...ok, ageYears: -1 })).toThrow(RangeError);
    expect(() => mifflinStJeorBmr({ ...ok, bodyweightKg: Number.NaN })).toThrow(RangeError);
  });
});

describe('activity multipliers', () => {
  it('are the conventional ladder and are strictly increasing', () => {
    const order: ActivityLevel[] = [
      'sedentary',
      'lightly_active',
      'moderately_active',
      'very_active',
      'extremely_active',
    ];
    expect(order.map((l) => ACTIVITY_MULTIPLIERS[l])).toEqual([1.2, 1.375, 1.55, 1.725, 1.9]);
    for (let i = 1; i < order.length; i++) {
      const prev = ACTIVITY_MULTIPLIERS[order[i - 1] as ActivityLevel];
      expect(ACTIVITY_MULTIPLIERS[order[i] as ActivityLevel]).toBeGreaterThan(prev);
    }
  });

  it('scale BMR into TDEE', () => {
    expect(tdeeKcal(1780, 'moderately_active')).toBeCloseTo(1780 * 1.55, 9);
  });
});

describe('validateAge', () => {
  it('passes an adult age through untouched', () => {
    expect(validateAge(35)).toEqual({ ageYears: 35, adjustment: null });
  });

  it('clamps and flags a minor rather than silently extrapolating', () => {
    const out = validateAge(14);
    expect(out.ageYears).toBe(MIN_VALIDATED_AGE_YEARS);
    expect(out.adjustment?.code).toBe('age_outside_validated_range');
    expect(out.adjustment?.requested).toBe(14);
  });

  it('clamps and flags an age above the validated band', () => {
    const out = validateAge(94);
    expect(out.ageYears).toBe(MAX_VALIDATED_AGE_YEARS);
    expect(out.adjustment?.code).toBe('age_outside_validated_range');
  });
});

describe('estimateMaintenanceKcal', () => {
  it('reports BMR and TDEE together, rounded only at the boundary', () => {
    const out = estimateMaintenanceKcal({
      bodyweightKg: 80,
      heightCm: 180,
      ageYears: 30,
      biologicalSex: 'male',
      activityLevel: 'moderately_active',
    });
    expect(out.bmrKcal).toBe(1780);
    expect(out.tdeeKcal).toBe(Math.round(1780 * 1.55)); // 2759
    expect(out.adjustments).toEqual([]);
  });

  it('propagates the age flag', () => {
    const out = estimateMaintenanceKcal({
      bodyweightKg: 55,
      heightCm: 165,
      ageYears: 15,
      biologicalSex: 'female',
      activityLevel: 'sedentary',
    });
    expect(out.adjustments.map((a) => a.code)).toContain('age_outside_validated_range');
  });

  it('does not round intermediate values — the result is path-independent', () => {
    // Chosen because BMR lands on .5 and the multiplier straddles an integer:
    // rounding BMR first gives 2474, keeping full precision gives 2473.
    const out = estimateMaintenanceKcal({
      bodyweightKg: 50,
      heightCm: 170,
      ageYears: 20,
      biologicalSex: 'female',
      activityLevel: 'extremely_active',
    });
    const bmrExact = 10 * 50 + 6.25 * 170 - 5 * 20 - 161; // 1301.5
    expect(out.tdeeKcal).toBe(Math.round(bmrExact * 1.9));
    expect(out.tdeeKcal).toBe(2473);
    // Rounding BMR first would give a different answer; assert it would have.
    expect(Math.round(Math.round(bmrExact) * 1.9)).toBe(2474);
    expect(Math.round(Math.round(bmrExact) * 1.9)).not.toBe(out.tdeeKcal);
  });
});

describe('dailyEnergyDeltaForRate', () => {
  it('spreads a weekly rate across seven days at 7700 kcal/kg', () => {
    expect(dailyEnergyDeltaForRate(-0.5, KCAL_PER_KG_BODY_MASS)).toBeCloseTo(-550, 6);
    expect(dailyEnergyDeltaForRate(0.25, KCAL_PER_KG_BODY_MASS)).toBeCloseTo(275, 6);
    expect(dailyEnergyDeltaForRate(0, KCAL_PER_KG_BODY_MASS)).toBe(0);
  });
});
