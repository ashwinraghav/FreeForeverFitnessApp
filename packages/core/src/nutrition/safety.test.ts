import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE_FLOOR_KCAL,
  bmi,
  bodyweightAtBmi,
  clampGoalBodyweightKg,
  clampRateKgPerWeek,
  energyFloorKcal,
  MAX_GAIN_KG_PER_WEEK,
  MAX_LOSS_KG_PER_WEEK,
  maxGainKgPerWeek,
  maxLossKgPerWeek,
  MIN_HEALTHY_BMI,
} from './safety.js';

describe('rate caps', () => {
  it('caps loss at 1% of bodyweight per week', () => {
    expect(maxLossKgPerWeek(70)).toBeCloseTo(0.7, 9);
    expect(maxLossKgPerWeek(45)).toBeCloseTo(0.45, 9);
  });

  it('also caps loss absolutely, so a heavy user is not given 1.5 kg/week', () => {
    expect(maxLossKgPerWeek(200)).toBe(MAX_LOSS_KG_PER_WEEK);
    expect(maxLossKgPerWeek(200)).toBe(1.0);
  });

  it('caps gain more tightly than loss, because faster gain is fat, not muscle', () => {
    expect(maxGainKgPerWeek(70)).toBeCloseTo(0.35, 9);
    expect(maxGainKgPerWeek(200)).toBe(MAX_GAIN_KG_PER_WEEK);
    expect(maxGainKgPerWeek(70)).toBeLessThan(maxLossKgPerWeek(70));
  });
});

describe('clampRateKgPerWeek', () => {
  it('leaves a sane request alone and reports no adjustment', () => {
    expect(clampRateKgPerWeek(-0.5, 80)).toEqual({ rate: -0.5, adjustment: null });
  });

  it('clamps an aggressive loss request and says so', () => {
    const out = clampRateKgPerWeek(-2, 70);
    expect(out.rate).toBeCloseTo(-0.7, 9);
    expect(out.adjustment).toMatchObject({ code: 'rate_capped_to_safe_maximum', requested: -2 });
  });

  it('clamps an aggressive gain request', () => {
    const out = clampRateKgPerWeek(2, 70);
    expect(out.rate).toBeCloseTo(0.35, 9);
    expect(out.adjustment?.code).toBe('rate_capped_to_safe_maximum');
  });

  it('is idempotent — clamping an already-clamped rate changes nothing', () => {
    const once = clampRateKgPerWeek(-5, 90).rate;
    expect(clampRateKgPerWeek(once, 90)).toEqual({ rate: once, adjustment: null });
  });
});

describe('bmi', () => {
  it('computes from canonical units', () => {
    expect(bmi(70, 175)).toBeCloseTo(70 / 1.75 ** 2, 9);
    expect(bmi(70, 175)).toBeCloseTo(22.857, 3);
  });

  it('inverts', () => {
    expect(bmi(bodyweightAtBmi(22, 175), 175)).toBeCloseTo(22, 9);
  });
});

describe('goal bodyweight floor', () => {
  it('accepts a goal weight inside the healthy band', () => {
    expect(clampGoalBodyweightKg(65, 175)).toEqual({ bodyweightKg: 65, adjustment: null });
  });

  it('refuses to aim below a BMI of 18.5, and says what it did instead', () => {
    const floor = bodyweightAtBmi(MIN_HEALTHY_BMI, 175); // ≈ 56.66 kg
    const out = clampGoalBodyweightKg(48, 175);
    expect(out.bodyweightKg).toBeCloseTo(floor, 9);
    expect(out.adjustment).toMatchObject({
      code: 'goal_weight_raised_to_minimum_healthy_bmi',
      requested: 48,
    });
    expect(bmi(out.bodyweightKg, 175)).toBeCloseTo(MIN_HEALTHY_BMI, 9);
  });

  it('scales the floor with height rather than using one number for everybody', () => {
    expect(clampGoalBodyweightKg(45, 150).bodyweightKg).toBeLessThan(
      clampGoalBodyweightKg(45, 190).bodyweightKg,
    );
  });
});

describe('energyFloorKcal', () => {
  it('takes the population minimum when BMR is below it', () => {
    expect(energyFloorKcal('female', 1100)).toBe(ABSOLUTE_FLOOR_KCAL.female);
    expect(energyFloorKcal('male', 1400)).toBe(ABSOLUTE_FLOOR_KCAL.male);
  });

  it('takes BMR when BMR is the higher, individualised floor', () => {
    expect(energyFloorKcal('female', 1650)).toBe(1650);
    expect(energyFloorKcal('male', 1900)).toBe(1900);
  });

  it('gives unspecified the lower absolute floor, so a small person is not overfed', () => {
    expect(ABSOLUTE_FLOOR_KCAL.unspecified).toBe(ABSOLUTE_FLOOR_KCAL.female);
    expect(ABSOLUTE_FLOOR_KCAL.unspecified).toBeLessThan(ABSOLUTE_FLOOR_KCAL.male);
  });
});
