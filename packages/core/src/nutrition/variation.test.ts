import { describe, expect, it } from 'vitest';
import {
  flatWeek,
  isoWeekdayOf,
  ISO_WEEKDAYS,
  MAX_SWING_FRACTION,
  planWeeklyTargets,
  roundPreservingTotal,
  targetForDate,
  withEnergy,
  type IsoWeekday,
} from './variation.js';
import { KCAL_PER_GRAM, type MacroTargetValues } from './types.js';

/** Self-consistent: 160×4 + 260×4 + 80×9 = 2400 kcal exactly. */
const BASE: MacroTargetValues = {
  energyKcal: 2400,
  proteinG: 160,
  carbsG: 260,
  fatG: 80,
  fiberG: 34,
  waterMl: 2800,
};

const MON_WED_FRI: IsoWeekday[] = [1, 3, 5];

function weekTotal(days: Record<IsoWeekday, MacroTargetValues>): number {
  return ISO_WEEKDAYS.reduce((sum, d) => sum + days[d].energyKcal, 0);
}

describe('roundPreservingTotal', () => {
  it('rounds to integers that sum to the rounded total', () => {
    const values = [1.5, 1.5, 1.5, 1.5];
    const out = roundPreservingTotal(values);
    expect(out.reduce((a, b) => a + b, 0)).toBe(6);
    expect(out.every(Number.isInteger)).toBe(true);
  });

  it('beats naive per-element rounding, which drifts', () => {
    const values = [0.6, 0.6, 0.6, 0.6, 0.6];
    expect(values.map(Math.round).reduce((a, b) => a + b, 0)).toBe(5); // drifted up by 2
    expect(roundPreservingTotal(values).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('handles a negative remainder, where every element rounds up', () => {
    const out = roundPreservingTotal([0.9, 0.9, 0.9]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('is deterministic on ties', () => {
    const values = [1.5, 1.5, 1.5];
    expect(roundPreservingTotal(values)).toEqual(roundPreservingTotal(values));
    expect(roundPreservingTotal(values)).toEqual([2, 2, 1]);
  });

  it('preserves the total for arbitrary inputs', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const values = Array.from({ length: 7 }, (_, i) => ((seed * 37 + i * 13) % 1000) / 7);
      const out = roundPreservingTotal(values);
      expect(out.reduce((a, b) => a + b, 0)).toBe(
        Math.round(values.reduce((a, b) => a + b, 0)),
      );
    }
  });
});

describe('withEnergy', () => {
  it('moves the whole difference into carbohydrate', () => {
    const higher = withEnergy(BASE, 2800);
    expect(higher.proteinG).toBe(BASE.proteinG);
    expect(higher.fatG).toBe(BASE.fatG);
    expect(higher.carbsG).toBeCloseTo(BASE.carbsG + 400 / KCAL_PER_GRAM.carb, 1);
  });

  it('never lets carbohydrate go negative', () => {
    expect(withEnergy(BASE, 200).carbsG).toBe(0);
  });

  it('carries fibre and water through unchanged', () => {
    expect(withEnergy(BASE, 2800)).toMatchObject({ fiberG: 34, waterMl: 2800 });
  });
});

describe('planWeeklyTargets', () => {
  it('is flat when there are no training days', () => {
    const out = planWeeklyTargets({
      base: BASE,
      plan: { trainingDays: [], swingFraction: 0.2 },
      energyFloorKcal: 1600,
    });
    expect(out.appliedSwingFraction).toBe(0);
    expect(weekTotal(out.days)).toBe(BASE.energyKcal * 7);
  });

  it('is flat when every day is a training day — there is nothing to cycle against', () => {
    const out = planWeeklyTargets({
      base: BASE,
      plan: { trainingDays: [1, 2, 3, 4, 5, 6, 7], swingFraction: 0.2 },
      energyFloorKcal: 1600,
    });
    expect(out.appliedSwingFraction).toBe(0);
    expect(ISO_WEEKDAYS.every((d) => out.days[d].energyKcal === BASE.energyKcal)).toBe(true);
  });

  it('is flat at a zero swing', () => {
    const out = planWeeklyTargets({
      base: BASE,
      plan: { trainingDays: MON_WED_FRI, swingFraction: 0 },
      energyFloorKcal: 1600,
    });
    expect(out.days).toEqual(flatWeek(BASE));
  });

  it('raises training days and lowers rest days', () => {
    const out = planWeeklyTargets({
      base: BASE,
      plan: { trainingDays: MON_WED_FRI, swingFraction: 0.15 },
      energyFloorKcal: 1600,
    });
    expect(out.days[1].energyKcal).toBeGreaterThan(BASE.energyKcal);
    expect(out.days[3].energyKcal).toBe(out.days[1].energyKcal);
    expect(out.days[2].energyKcal).toBeLessThan(BASE.energyKcal);
    expect(out.days[6].energyKcal).toBe(out.days[2].energyKcal);
  });

  it('preserves the weekly total exactly, including after rounding', () => {
    for (const swing of [0.05, 0.1, 0.15, 0.2, 0.25]) {
      for (const training of [[1], [1, 4], MON_WED_FRI, [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6]]) {
        const out = planWeeklyTargets({
          base: BASE,
          plan: { trainingDays: training as IsoWeekday[], swingFraction: swing },
          energyFloorKcal: 1400,
        });
        expect(weekTotal(out.days)).toBe(BASE.energyKcal * 7);
      }
    }
  });

  it('holds protein and fat constant, so only carbohydrate cycles', () => {
    const out = planWeeklyTargets({
      base: BASE,
      plan: { trainingDays: MON_WED_FRI, swingFraction: 0.2 },
      energyFloorKcal: 1400,
    });
    for (const d of ISO_WEEKDAYS) {
      expect(out.days[d].proteinG).toBe(BASE.proteinG);
      expect(out.days[d].fatG).toBe(BASE.fatG);
      expect(out.days[d].fiberG).toBe(BASE.fiberG);
    }
    expect(out.days[1].carbsG).toBeGreaterThan(out.days[2].carbsG);
  });

  it('keeps every day’s macros accounting for that day’s energy', () => {
    const out = planWeeklyTargets({
      base: BASE,
      plan: { trainingDays: MON_WED_FRI, swingFraction: 0.2 },
      energyFloorKcal: 1400,
    });
    for (const d of ISO_WEEKDAYS) {
      const v = out.days[d];
      const kcal = v.proteinG * 4 + v.carbsG * 4 + v.fatG * 9;
      expect(Math.abs(kcal - v.energyKcal)).toBeLessThan(1);
    }
  });

  it('reduces the swing rather than pushing a rest day below the safety floor', () => {
    // Floor at 2200 leaves almost no room below a 2400 base.
    const out = planWeeklyTargets({
      base: BASE,
      plan: { trainingDays: MON_WED_FRI, swingFraction: 0.25 },
      energyFloorKcal: 2200,
    });
    expect(out.appliedSwingFraction).toBeLessThan(0.25);
    expect(out.adjustments.map((a) => a.code)).toContain('day_variation_reduced_to_respect_floor');
    for (const d of ISO_WEEKDAYS) expect(out.days[d].energyKcal).toBeGreaterThanOrEqual(2199);
    expect(weekTotal(out.days)).toBe(BASE.energyKcal * 7);
  });

  it('gives up on cycling entirely when the floor equals the base', () => {
    const out = planWeeklyTargets({
      base: BASE,
      plan: { trainingDays: MON_WED_FRI, swingFraction: 0.25 },
      energyFloorKcal: BASE.energyKcal,
    });
    expect(out.appliedSwingFraction).toBe(0);
    expect(out.days).toEqual(flatWeek(BASE));
  });

  it('never lets a rest day fall below the floor, across a sweep', () => {
    for (const floor of [1200, 1600, 1900, 2100, 2300]) {
      for (const swing of [0.05, 0.15, 0.25, 0.9]) {
        for (const n of [1, 2, 3, 4, 5, 6]) {
          const training = ISO_WEEKDAYS.slice(0, n) as IsoWeekday[];
          const out = planWeeklyTargets({
            base: BASE,
            plan: { trainingDays: training, swingFraction: swing },
            energyFloorKcal: floor,
          });
          for (const d of ISO_WEEKDAYS) {
            // ≤1 kcal of integer-apportionment slack.
            expect(out.days[d].energyKcal).toBeGreaterThanOrEqual(Math.min(floor, BASE.energyKcal) - 1);
            expect(out.days[d].carbsG).toBeGreaterThanOrEqual(0);
          }
          expect(weekTotal(out.days)).toBe(BASE.energyKcal * 7);
        }
      }
    }
  });

  it('clamps a swing beyond the documented maximum', () => {
    const out = planWeeklyTargets({
      base: BASE,
      plan: { trainingDays: [1], swingFraction: 5 },
      energyFloorKcal: 1200,
    });
    expect(out.appliedSwingFraction).toBeLessThanOrEqual(MAX_SWING_FRACTION);
  });

  it('ignores duplicate training days', () => {
    const withDupes = planWeeklyTargets({
      base: BASE,
      plan: { trainingDays: [1, 1, 3, 3, 5], swingFraction: 0.15 },
      energyFloorKcal: 1400,
    });
    const without = planWeeklyTargets({
      base: BASE,
      plan: { trainingDays: MON_WED_FRI, swingFraction: 0.15 },
      energyFloorKcal: 1400,
    });
    expect(withDupes.days).toEqual(without.days);
  });
});

describe('isoWeekdayOf', () => {
  it('maps a known date to its ISO weekday', () => {
    expect(isoWeekdayOf('2026-08-28')).toBe(5); // a Friday
    expect(isoWeekdayOf('2026-08-30')).toBe(7); // Sunday is 7, not 0
    expect(isoWeekdayOf('2026-08-31')).toBe(1); // Monday
  });

  it('walks forward one day at a time without skipping', () => {
    const seen = [
      '2026-03-02','2026-03-03','2026-03-04','2026-03-05','2026-03-06','2026-03-07','2026-03-08',
    ].map(isoWeekdayOf);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('is unaffected by the running process’s timezone', () => {
    // The string is already a local date; re-interpreting it would shift the day.
    expect(isoWeekdayOf('2026-01-01')).toBe(4); // Thursday
  });
});

describe('targetForDate', () => {
  it('picks the plan entry for that date’s weekday', () => {
    const plan = planWeeklyTargets({
      base: BASE,
      plan: { trainingDays: MON_WED_FRI, swingFraction: 0.15 },
      energyFloorKcal: 1400,
    });
    // 2026-08-28 is a Friday, a training day.
    expect(targetForDate(plan.days, '2026-08-28')).toEqual(plan.days[5]);
    expect(targetForDate(plan.days, '2026-08-28').energyKcal).toBeGreaterThan(BASE.energyKcal);
    // 2026-08-29 is a Saturday, a rest day.
    expect(targetForDate(plan.days, '2026-08-29').energyKcal).toBeLessThan(BASE.energyKcal);
  });
});
