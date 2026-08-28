import { describe, expect, it } from 'vitest';
import {
  consensusOneRepMax,
  E1RM_FORMULA_NAMES,
  estimateOneRepMax,
  estimateRepMax,
  isReliableRepRange,
  loadForReps,
  oneRepMaxMultiplier,
  repsAtLoad,
  type E1rmFormula,
} from './e1rm.js';

describe('a true single is its own one-rep max', () => {
  it.each(E1RM_FORMULA_NAMES)('%s returns the weight exactly at one rep', (formula) => {
    expect(estimateOneRepMax(100, 1, formula)).toBe(100);
    expect(estimateOneRepMax(142.5, 1, formula)).toBe(142.5);
  });

  it('does not inherit Epley\'s 3.3% overshoot at one rep', () => {
    // Epley's raw form gives 103.33 for a 100kg single. Showing a lifter a bigger
    // number than the one on the bar they just pulled is how a log loses trust.
    expect(estimateOneRepMax(100, 1, 'epley')).not.toBeCloseTo(103.33, 1);
  });
});

describe('reps outside the domain', () => {
  it.each(E1RM_FORMULA_NAMES)('%s has no estimate at zero reps', (formula) => {
    expect(estimateOneRepMax(100, 0, formula)).toBeNull();
  });

  it.each(E1RM_FORMULA_NAMES)('%s has no estimate at negative reps', (formula) => {
    expect(estimateOneRepMax(100, -3, formula)).toBeNull();
  });

  it.each(E1RM_FORMULA_NAMES)('%s rejects fractional reps', (formula) => {
    expect(estimateOneRepMax(100, 4.5, formula)).toBeNull();
  });

  it('Brzycki is null rather than infinite at its pole', () => {
    // 36 / (37 - 37) is a division by zero, and 36 / (37 - 40) is negative.
    expect(estimateOneRepMax(100, 36, 'brzycki')).not.toBeNull();
    expect(estimateOneRepMax(100, 37, 'brzycki')).toBeNull();
    expect(estimateOneRepMax(100, 40, 'brzycki')).toBeNull();
  });

  it('Lander is null rather than infinite at its pole', () => {
    // 101.3 / 2.67123 = 37.92, so 37 is the last rep count in domain.
    expect(estimateOneRepMax(100, 37, 'lander')).not.toBeNull();
    expect(estimateOneRepMax(100, 38, 'lander')).toBeNull();
    expect(estimateOneRepMax(100, 100, 'lander')).toBeNull();
  });

  it.each(E1RM_FORMULA_NAMES)('%s never returns a non-finite number', (formula) => {
    for (let reps = 0; reps <= 60; reps += 1) {
      const value = estimateOneRepMax(100, reps, formula);
      if (value !== null) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    }
  });
});

describe('load outside the domain', () => {
  it.each(E1RM_FORMULA_NAMES)('%s rejects a negative load', (formula) => {
    expect(estimateOneRepMax(-60, 5, formula)).toBeNull();
  });

  it.each(E1RM_FORMULA_NAMES)('%s rejects NaN and Infinity', (formula) => {
    expect(estimateOneRepMax(Number.NaN, 5, formula)).toBeNull();
    expect(estimateOneRepMax(Number.POSITIVE_INFINITY, 5, formula)).toBeNull();
  });

  it('accepts a zero load and returns zero', () => {
    // An unloaded bar for five is a real logged set; it just has no max in it.
    expect(estimateOneRepMax(0, 5, 'epley')).toBe(0);
  });
});

describe('published values', () => {
  it('matches Epley by hand', () => {
    // 100 * (1 + 10/30) = 133.33
    expect(estimateOneRepMax(100, 10, 'epley')).toBeCloseTo(133.33, 2);
  });

  it('matches Brzycki by hand', () => {
    // 100 * 36 / (37 - 10) = 133.33
    expect(estimateOneRepMax(100, 10, 'brzycki')).toBeCloseTo(133.33, 2);
  });

  it('matches O\'Conner by hand', () => {
    // 100 * (1 + 10/40) = 125
    expect(estimateOneRepMax(100, 10, 'oconner')).toBe(125);
  });

  it('matches Lombardi by hand', () => {
    // 100 * 10^0.1 = 125.89
    expect(estimateOneRepMax(100, 10, 'lombardi')).toBeCloseTo(125.89, 2);
  });

  it('matches Wathan by hand', () => {
    // 100 * 100 / (48.8 + 53.8 * e^-0.75) = 100 / 74.213 * 100 = 134.75
    expect(estimateOneRepMax(100, 10, 'wathan')).toBeCloseTo(134.75, 2);
  });

  it('matches Mayhew by hand', () => {
    // 100 * 100 / (52.2 + 41.9 * e^-0.55) = 100 / 76.374 * 100 = 130.93
    expect(estimateOneRepMax(100, 10, 'mayhew')).toBeCloseTo(130.93, 2);
  });

  it('matches Lander by hand', () => {
    // 100 * 100 / (101.3 - 26.7123) = 134.07
    expect(estimateOneRepMax(100, 10, 'lander')).toBeCloseTo(134.07, 1);
  });
});

describe('monotonicity — the property that makes a chart readable', () => {
  it.each(E1RM_FORMULA_NAMES)('%s: more reps at the same load is a bigger max', (formula) => {
    let previous = 0;
    for (let reps = 1; reps <= 12; reps += 1) {
      const value = estimateOneRepMax(100, reps, formula);
      expect(value).not.toBeNull();
      expect(value as number).toBeGreaterThanOrEqual(previous);
      previous = value as number;
    }
  });

  it.each(E1RM_FORMULA_NAMES)('%s: more load at the same reps is a bigger max', (formula) => {
    const light = estimateOneRepMax(80, 5, formula) as number;
    const heavy = estimateOneRepMax(120, 5, formula) as number;
    expect(heavy).toBeGreaterThan(light);
  });
});

describe('the inverse direction', () => {
  const inDomain: E1rmFormula[] = [...E1RM_FORMULA_NAMES];

  it.each(inDomain)('%s: estimateRepMax(w, r, r) round-trips to w', (formula) => {
    for (let reps = 1; reps <= 12; reps += 1) {
      expect(estimateRepMax(100, reps, reps, formula)).toBeCloseTo(100, 1);
    }
  });

  it.each(inDomain)('%s: loadForReps undoes oneRepMaxMultiplier', (formula) => {
    const max = estimateOneRepMax(100, 8, formula) as number;
    expect(loadForReps(max, 8, formula)).toBeCloseTo(100, 1);
  });

  it('a one-rep max prescribes itself for one rep', () => {
    expect(loadForReps(200, 1, 'epley')).toBe(200);
  });

  it('returns null where the forward direction does', () => {
    expect(loadForReps(200, 40, 'brzycki')).toBeNull();
    expect(loadForReps(-1, 5, 'epley')).toBeNull();
  });

  it('multiplier at one rep is exactly one for every formula', () => {
    for (const formula of E1RM_FORMULA_NAMES) {
      expect(oneRepMaxMultiplier(1, formula)).toBe(1);
    }
  });
});

describe('repsAtLoad', () => {
  it('gives zero reps for a load above the max', () => {
    expect(repsAtLoad(100, 110)).toBe(0);
  });

  it('gives one rep at the max itself', () => {
    expect(repsAtLoad(100, 100)).toBe(1);
  });

  it('floors rather than rounds', () => {
    // Epley predicts 100kg -> 83.33 for 6 and 80 for 8. At 82kg the honest answer is
    // 6, not 7: telling a lifter they have one more than they do is how people get
    // stapled to a bench.
    const reps = repsAtLoad(100, 82, 'epley');
    expect(reps).toBe(6);
    expect(loadForReps(100, reps as number, 'epley') as number).toBeGreaterThanOrEqual(82);
  });

  it('rejects nonsense inputs', () => {
    expect(repsAtLoad(0, 50)).toBeNull();
    expect(repsAtLoad(100, 0)).toBeNull();
    expect(repsAtLoad(Number.NaN, 50)).toBeNull();
  });
});

describe('consensus', () => {
  it('sits between the most and least optimistic formulas', () => {
    const all = E1RM_FORMULA_NAMES.map((f) => estimateOneRepMax(100, 8, f) as number);
    const consensus = consensusOneRepMax(100, 8) as number;
    expect(consensus).toBeGreaterThanOrEqual(Math.min(...all));
    expect(consensus).toBeLessThanOrEqual(Math.max(...all));
  });

  it('is the weight itself at one rep', () => {
    expect(consensusOneRepMax(140, 1)).toBe(140);
  });

  it('still answers where two formulas have dropped out', () => {
    // At 40 reps Brzycki and Lander are out of domain; the other five are not.
    expect(consensusOneRepMax(60, 40)).not.toBeNull();
  });

  it('has no opinion on a set that did not happen', () => {
    expect(consensusOneRepMax(100, 0)).toBeNull();
  });
});

describe('reliability flag', () => {
  it('covers one to twelve', () => {
    expect(isReliableRepRange(1)).toBe(true);
    expect(isReliableRepRange(12)).toBe(true);
    expect(isReliableRepRange(13)).toBe(false);
    expect(isReliableRepRange(0)).toBe(false);
    expect(isReliableRepRange(5.5)).toBe(false);
  });
});
