import { describe, expect, it } from 'vitest';
import { estimateMaintenanceKcal } from './energy.js';
import {
  ABSOLUTE_FLOOR_KCAL,
  energyFloorKcal,
  MAX_DEFICIT_FRACTION_OF_TDEE,
  MAX_SURPLUS_FRACTION_OF_TDEE,
  maxLossKgPerWeek,
} from './safety.js';
import {
  calculateMacroTarget,
  ENERGY_TARGET_ROUNDING_KCAL,
  FIBRE_G_PER_1000_KCAL,
  macrosForEnergy,
  manualMacroTarget,
  MAX_PROTEIN_FRACTION_OF_ENERGY,
  MIN_FAT_G_PER_KG,
  MIN_PROTEIN_G_PER_KG,
  PROTEIN_G_PER_KG,
  WATER_ML_PER_KG,
} from './targets.js';
import {
  KCAL_PER_GRAM,
  type ActivityLevel,
  type BiologicalSex,
  type Goal,
  type MacroTargetValues,
} from './types.js';

const GOALS: Goal[] = ['lose_fat', 'maintain', 'gain_muscle', 'recomp', 'performance'];
const ACTIVITY: ActivityLevel[] = [
  'sedentary',
  'lightly_active',
  'moderately_active',
  'very_active',
  'extremely_active',
];
const SEXES: BiologicalSex[] = ['female', 'male', 'unspecified'];

function macroKcal(v: MacroTargetValues): number {
  return (
    v.proteinG * KCAL_PER_GRAM.protein +
    v.carbsG * KCAL_PER_GRAM.carb +
    v.fatG * KCAL_PER_GRAM.fat
  );
}

describe('macrosForEnergy', () => {
  it('sets protein from bodyweight and the goal', () => {
    const { values } = macrosForEnergy({ energyKcal: 2500, bodyweightKg: 80, goal: 'lose_fat' });
    expect(values.proteinG).toBeCloseTo(80 * PROTEIN_G_PER_KG.lose_fat, 1);
  });

  it('lets carbohydrate take the remainder so the split always sums to the target', () => {
    const { values } = macrosForEnergy({ energyKcal: 2500, bodyweightKg: 80, goal: 'maintain' });
    expect(macroKcal(values)).toBeCloseTo(2500, 0);
  });

  it('honours a custom protein figure — the paywalled feature, unpaywalled', () => {
    const { values } = macrosForEnergy({
      energyKcal: 2500,
      bodyweightKg: 80,
      goal: 'maintain',
      proteinGPerKg: 2.5,
    });
    expect(values.proteinG).toBeCloseTo(200, 1);
    expect(macroKcal(values)).toBeCloseTo(2500, 0);
  });

  it('honours a custom fat fraction', () => {
    const { values } = macrosForEnergy({
      energyKcal: 2500,
      bodyweightKg: 80,
      goal: 'maintain',
      fatFractionOfEnergy: 0.4,
    });
    expect(values.fatG).toBeCloseTo((2500 * 0.4) / 9, 1);
  });

  it('raises fat to the essential minimum and reports it', () => {
    // A heavy person on a low target: 0.5 g/kg beats the percentage.
    const out = macrosForEnergy({
      energyKcal: 1500,
      bodyweightKg: 120,
      goal: 'performance', // lowest fat fraction, 25%
    });
    expect(out.values.fatG).toBeCloseTo(120 * MIN_FAT_G_PER_KG, 1);
    expect(out.adjustments.map((a) => a.code)).toContain('fat_raised_to_essential_minimum');
  });

  it('caps protein as a share of energy rather than letting it eat the whole budget', () => {
    const out = macrosForEnergy({ energyKcal: 1400, bodyweightKg: 100, goal: 'recomp' }); // 220 g asked
    expect(out.values.proteinG).toBeLessThanOrEqual(
      (1400 * MAX_PROTEIN_FRACTION_OF_ENERGY) / KCAL_PER_GRAM.protein + 0.05,
    );
    expect(out.adjustments.map((a) => a.code)).toContain('protein_reduced_to_fit_energy_budget');
  });

  it('never drops protein below the RDA to make room', () => {
    const out = macrosForEnergy({ energyKcal: 900, bodyweightKg: 120, goal: 'recomp' });
    expect(out.values.proteinG).toBeGreaterThanOrEqual(120 * MIN_PROTEIN_G_PER_KG - 0.05);
  });

  it('raises energy rather than shipping a split that does not add up', () => {
    // Both minimums together (3.2 + 4.5 = 7.7 kcal/kg) exceed the requested target.
    const bodyweightKg = 120;
    const out = macrosForEnergy({ energyKcal: 700, bodyweightKg, goal: 'recomp' });
    expect(out.adjustments.map((a) => a.code)).toContain('energy_raised_to_cover_macro_minimums');
    expect(out.values.energyKcal).toBeGreaterThan(700);
    expect(out.values.carbsG).toBe(0);
    expect(macroKcal(out.values)).toBeCloseTo(out.values.energyKcal, 0);
    expect(out.values.fatG).toBeGreaterThanOrEqual(bodyweightKg * MIN_FAT_G_PER_KG - 0.05);
    expect(out.values.proteinG).toBeGreaterThanOrEqual(bodyweightKg * MIN_PROTEIN_G_PER_KG - 0.05);
  });

  it('never produces a negative macro', () => {
    for (const goal of GOALS) {
      for (let kcal = 600; kcal <= 5000; kcal += 100) {
        for (const bw of [40, 60, 80, 100, 150]) {
          const { values } = macrosForEnergy({ energyKcal: kcal, bodyweightKg: bw, goal });
          expect(values.proteinG).toBeGreaterThanOrEqual(0);
          expect(values.carbsG).toBeGreaterThanOrEqual(0);
          expect(values.fatG).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('always has its macros account for its own stated energy', () => {
    for (const goal of GOALS) {
      for (let kcal = 600; kcal <= 5000; kcal += 100) {
        for (const bw of [40, 60, 80, 100, 150]) {
          const { values } = macrosForEnergy({ energyKcal: kcal, bodyweightKg: bw, goal });
          // Within a kilocalorie: macros are stored to 0.1 g, worth ≤ 0.9 kcal.
          expect(Math.abs(macroKcal(values) - values.energyKcal)).toBeLessThan(1);
        }
      }
    }
  });

  it('derives fibre and water from energy and bodyweight', () => {
    const { values } = macrosForEnergy({ energyKcal: 2000, bodyweightKg: 70, goal: 'maintain' });
    expect(values.fiberG).toBe(Math.round((2000 / 1000) * FIBRE_G_PER_1000_KCAL));
    expect(values.waterMl).toBe(Math.round(70 * WATER_ML_PER_KG));
  });
});

describe('calculateMacroTarget — the ordinary case', () => {
  const base = {
    bodyweightKg: 80,
    heightCm: 180,
    ageYears: 30,
    biologicalSex: 'male' as const,
    activityLevel: 'moderately_active' as const,
    goal: 'lose_fat' as const,
    rateKgPerWeek: -0.5,
  };

  it('produces a target a fifth-of-a-kilo-a-week deficit below maintenance', () => {
    const out = calculateMacroTarget(base);
    // TDEE 2759, minus 550/day for 0.5 kg/week, rounded to 10 → 2210.
    expect(out.basis.tdeeKcal).toBe(2759);
    expect(out.values.energyKcal).toBe(2210);
    expect(out.adjustments).toEqual([]);
  });

  it('rounds the energy target to a round number, because false precision invites false trust', () => {
    for (const rate of [-0.73, -0.41, 0, 0.19, 0.33]) {
      const out = calculateMacroTarget({ ...base, rateKgPerWeek: rate });
      expect(out.values.energyKcal % ENERGY_TARGET_ROUNDING_KCAL).toBe(0);
    }
  });

  it('reports the rate the target actually delivers, not the one requested', () => {
    const out = calculateMacroTarget({ ...base, rateKgPerWeek: -5 });
    expect(out.basis.rateKgPerWeek).toBeGreaterThan(-5);
    // The projection graph must agree with the target it is drawn from.
    const impliedDaily = (out.values.energyKcal - out.basis.tdeeKcal) / 1;
    expect(out.basis.rateKgPerWeek).toBeCloseTo((impliedDaily * 7) / 7700, 3);
  });

  it('carries the basis needed to explain the number', () => {
    const out = calculateMacroTarget(base);
    expect(out.basis).toMatchObject({
      bmrKcal: 1780,
      activityLevel: 'moderately_active',
      goal: 'lose_fat',
      bodyweightKg: 80,
    });
  });
});

describe('calculateMacroTarget — safety clamps', () => {
  const base = {
    bodyweightKg: 70,
    heightCm: 175,
    ageYears: 30,
    biologicalSex: 'female' as const,
    activityLevel: 'moderately_active' as const,
    goal: 'lose_fat' as const,
    rateKgPerWeek: -0.5,
  };

  it('caps an extreme rate request and names the clamp', () => {
    const out = calculateMacroTarget({ ...base, rateKgPerWeek: -2 });
    const codes = out.adjustments.map((a) => a.code);
    expect(codes).toContain('rate_capped_to_safe_maximum');
    // 2 kg/week was asked for; 1% of 70 kg is the most this app will prescribe.
    expect(maxLossKgPerWeek(70)).toBeCloseTo(0.7, 9);
  });

  it('caps the deficit at a quarter of TDEE even when the rate was legal', () => {
    // A light, sedentary person: 0.7 kg/week is a huge share of their TDEE.
    const out = calculateMacroTarget({
      ...base,
      bodyweightKg: 70,
      activityLevel: 'sedentary',
      rateKgPerWeek: -0.7,
    });
    const codes = out.adjustments.map((a) => a.code);
    expect(codes).toContain('deficit_capped_to_fraction_of_tdee');
    expect(out.values.energyKcal).toBeGreaterThanOrEqual(
      out.basis.tdeeKcal * (1 - MAX_DEFICIT_FRACTION_OF_TDEE) - ENERGY_TARGET_ROUNDING_KCAL,
    );
  });

  it('caps a surplus more tightly than a deficit', () => {
    const out = calculateMacroTarget({ ...base, goal: 'gain_muscle', rateKgPerWeek: 2 });
    expect(out.values.energyKcal).toBeLessThanOrEqual(
      out.basis.tdeeKcal * (1 + MAX_SURPLUS_FRACTION_OF_TDEE) + ENERGY_TARGET_ROUNDING_KCAL,
    );
  });

  it('raises a sedentary user’s target to their BMR and says which floor bound', () => {
    const out = calculateMacroTarget({
      bodyweightKg: 95,
      heightCm: 180,
      ageYears: 30,
      biologicalSex: 'male',
      activityLevel: 'sedentary',
      goal: 'lose_fat',
      rateKgPerWeek: -0.95,
    });
    expect(out.adjustments.map((a) => a.code)).toContain('energy_raised_to_bmr_floor');
    expect(out.values.energyKcal).toBeGreaterThanOrEqual(out.basis.bmrKcal);
  });

  it('raises a small user’s target to the absolute population floor', () => {
    const out = calculateMacroTarget({
      bodyweightKg: 45,
      heightCm: 155,
      ageYears: 25,
      biologicalSex: 'female',
      activityLevel: 'sedentary',
      goal: 'lose_fat',
      rateKgPerWeek: -0.45,
    });
    // BMR here is ~1133, below the 1200 population minimum, so that is the binding one.
    expect(out.basis.bmrKcal).toBeLessThan(ABSOLUTE_FLOOR_KCAL.female);
    expect(out.adjustments.map((a) => a.code)).toContain('energy_raised_to_absolute_floor');
    expect(out.values.energyKcal).toBeGreaterThanOrEqual(ABSOLUTE_FLOOR_KCAL.female);
  });

  it('flags an age outside the equation’s validated range', () => {
    const out = calculateMacroTarget({ ...base, ageYears: 15 });
    expect(out.adjustments.map((a) => a.code)).toContain('age_outside_validated_range');
  });
});

describe('the safety invariant, swept', () => {
  it('never prescribes below the binding floor, for any combination of inputs', () => {
    let checked = 0;
    for (const sex of SEXES) {
      for (const activity of ACTIVITY) {
        for (const goal of GOALS) {
          for (const bw of [40, 50, 65, 80, 100, 140, 180]) {
            for (const height of [145, 160, 175, 190, 205]) {
              for (const age of [16, 25, 45, 70, 95]) {
                for (const rate of [-3, -1, -0.5, 0, 0.5, 3]) {
                  const out = calculateMacroTarget({
                    bodyweightKg: bw,
                    heightCm: height,
                    ageYears: age,
                    biologicalSex: sex,
                    activityLevel: activity,
                    goal,
                    rateKgPerWeek: rate,
                  });
                  const floor = energyFloorKcal(sex, out.basis.bmrKcal);
                  expect(out.values.energyKcal).toBeGreaterThanOrEqual(Math.round(floor));
                  expect(out.values.energyKcal).toBeGreaterThanOrEqual(ABSOLUTE_FLOOR_KCAL[sex]);
                  expect(out.energyFloorKcal).toBe(Math.round(floor));
                  checked++;
                }
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(15000);
  });

  it('never prescribes a rate faster than the safe maximum, for any input', () => {
    for (const sex of SEXES) {
      for (const bw of [45, 70, 110, 160]) {
        for (const rate of [-5, -1, 1, 5]) {
          const out = calculateMacroTarget({
            bodyweightKg: bw,
            heightCm: 170,
            ageYears: 35,
            biologicalSex: sex,
            activityLevel: 'lightly_active',
            goal: rate < 0 ? 'lose_fat' : 'gain_muscle',
            rateKgPerWeek: rate,
          });
          // Rounding to 10 kcal can nudge the delivered rate by ≤ 0.01 kg/week.
          expect(out.basis.rateKgPerWeek).toBeGreaterThanOrEqual(-maxLossKgPerWeek(bw) - 0.01);
        }
      }
    }
  });

  it('always ships macros that account for the energy it prescribes', () => {
    for (const goal of GOALS) {
      for (const bw of [45, 70, 110, 160]) {
        for (const rate of [-2, -0.5, 0, 0.5]) {
          const out = calculateMacroTarget({
            bodyweightKg: bw,
            heightCm: 172,
            ageYears: 40,
            biologicalSex: 'unspecified',
            activityLevel: 'lightly_active',
            goal,
            rateKgPerWeek: rate,
          });
          expect(Math.abs(macroKcal(out.values) - out.values.energyKcal)).toBeLessThan(1);
        }
      }
    }
  });

  it('is deterministic — the same input always gives the same output', () => {
    const input = {
      bodyweightKg: 73.6,
      heightCm: 168,
      ageYears: 34,
      biologicalSex: 'female' as const,
      activityLevel: 'very_active' as const,
      goal: 'recomp' as const,
      rateKgPerWeek: -0.3,
    };
    expect(calculateMacroTarget(input)).toEqual(calculateMacroTarget(input));
  });
});

describe('manualMacroTarget — the hole every safety floor leaks through', () => {
  it('applies the same floor to a hand-entered number', () => {
    const out = manualMacroTarget({
      energyKcal: 800,
      bodyweightKg: 60,
      goal: 'lose_fat',
      biologicalSex: 'female',
    });
    expect(out.values.energyKcal).toBeGreaterThanOrEqual(ABSOLUTE_FLOOR_KCAL.female);
    expect(out.adjustments.map((a) => a.code)).toContain('energy_raised_to_absolute_floor');
  });

  it('uses the individualised BMR floor when the profile supports one', () => {
    const bmr = estimateMaintenanceKcal({
      bodyweightKg: 95,
      heightCm: 185,
      ageYears: 28,
      biologicalSex: 'male',
      activityLevel: 'sedentary',
    }).bmrKcal;
    const out = manualMacroTarget({
      energyKcal: 1600,
      bodyweightKg: 95,
      goal: 'lose_fat',
      biologicalSex: 'male',
      bmrKcal: bmr,
    });
    expect(out.values.energyKcal).toBe(Math.round(bmr));
    expect(out.adjustments.map((a) => a.code)).toContain('energy_raised_to_bmr_floor');
  });

  it('leaves a sane manual number alone', () => {
    const out = manualMacroTarget({
      energyKcal: 2400,
      bodyweightKg: 80,
      goal: 'maintain',
      biologicalSex: 'male',
      bmrKcal: 1780,
    });
    expect(out.values.energyKcal).toBe(2400);
    expect(out.adjustments).toEqual([]);
  });
});
