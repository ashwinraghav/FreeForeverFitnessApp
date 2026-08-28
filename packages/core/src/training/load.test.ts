import { describe, expect, it } from 'vitest';
import { effectiveLoadKg, externalLoadKg, fromGrams, isHeavierBetter, toGrams } from './load.js';
import type { Load } from './types.js';
import { ratingOfPerceivedExertion, repsInReserve } from './types.js';

describe('external load', () => {
  it('is the number on the bar when the log already includes the bar', () => {
    expect(effectiveLoadKg({ kind: 'external', weightKg: 100 })).toBe(100);
  });

  it('adds the implement when the log is plates only', () => {
    // `implementMassKg` present means the logged number is the plates; absent means it
    // is already the total. Getting this backwards is a silent 20kg on every chart.
    expect(effectiveLoadKg({ kind: 'external', weightKg: 80 }, { implementMassKg: 20 })).toBe(100);
  });

  it('does not need a bodyweight', () => {
    expect(effectiveLoadKg({ kind: 'external', weightKg: 60 }, {})).toBe(60);
  });
});

describe('bodyweight load', () => {
  it('is bodyweight plus what was added', () => {
    expect(
      effectiveLoadKg({ kind: 'bodyweight', addedWeightKg: 20 }, { bodyweightKg: 80 }),
    ).toBe(100);
  });

  it('is just bodyweight when nothing was added', () => {
    expect(effectiveLoadKg({ kind: 'bodyweight', addedWeightKg: 0 }, { bodyweightKg: 80 })).toBe(80);
  });

  it('handles a negative added weight — a band or a partner unloading', () => {
    expect(
      effectiveLoadKg({ kind: 'bodyweight', addedWeightKg: -10 }, { bodyweightKg: 80 }),
    ).toBe(70);
  });

  it('has no answer without a bodyweight, and says so rather than guessing zero', () => {
    // A chart with a gap is honest. A chart that plots zero draws a cliff the lifter
    // did not fall off.
    expect(effectiveLoadKg({ kind: 'bodyweight', addedWeightKg: 20 })).toBeNull();
  });
});

describe('assisted load — the one that inverts', () => {
  it('gets lighter as the assistance goes up', () => {
    const context = { bodyweightKg: 80 };
    const easy = effectiveLoadKg({ kind: 'assisted', assistanceKg: 40 }, context) as number;
    const hard = effectiveLoadKg({ kind: 'assisted', assistanceKg: 10 }, context) as number;
    expect(hard).toBeGreaterThan(easy);
    expect(easy).toBe(40);
    expect(hard).toBe(70);
  });

  it('is a progression when the assistance falls, not a regression', () => {
    // The whole reason load is a union: a naive `weightKg` makes the beginner who
    // moved from 40kg of help to 30kg look like they got weaker.
    const before = effectiveLoadKg({ kind: 'assisted', assistanceKg: 40 }, { bodyweightKg: 80 }) as number;
    const after = effectiveLoadKg({ kind: 'assisted', assistanceKg: 30 }, { bodyweightKg: 80 }) as number;
    expect(after).toBeGreaterThan(before);
  });

  it('floors at zero rather than going negative', () => {
    // A mis-entered 200kg of assistance must not become a -120kg personal record.
    expect(effectiveLoadKg({ kind: 'assisted', assistanceKg: 200 }, { bodyweightKg: 80 })).toBe(0);
  });

  it('has no answer without a bodyweight', () => {
    expect(effectiveLoadKg({ kind: 'assisted', assistanceKg: 20 })).toBeNull();
  });
});

describe('no load', () => {
  it('is the lifter, by default', () => {
    expect(effectiveLoadKg({ kind: 'none' }, { bodyweightKg: 80 })).toBe(80);
  });

  it('is zero when the caller says an unloaded movement is unloaded', () => {
    expect(
      effectiveLoadKg({ kind: 'none' }, { bodyweightKg: 80 }, { noneCountsBodyweight: false }),
    ).toBe(0);
  });

  it('has no answer without a bodyweight', () => {
    expect(effectiveLoadKg({ kind: 'none' })).toBeNull();
  });
});

describe('external-only view', () => {
  it('ignores the lifter entirely', () => {
    // Gaining 2kg of bodyweight did not add 2kg to your pull-up.
    expect(externalLoadKg({ kind: 'bodyweight', addedWeightKg: 20 }, { bodyweightKg: 80 })).toBe(20);
    expect(externalLoadKg({ kind: 'none' }, { bodyweightKg: 80 })).toBe(0);
  });

  it('reports assistance as negative resistance', () => {
    expect(externalLoadKg({ kind: 'assisted', assistanceKg: 30 })).toBe(-30);
  });

  it('still adds the implement', () => {
    expect(externalLoadKg({ kind: 'external', weightKg: 80 }, { implementMassKg: 20 })).toBe(100);
  });
});

describe('direction of progress', () => {
  const cases: Array<[Load, boolean]> = [
    [{ kind: 'external', weightKg: 100 }, true],
    [{ kind: 'bodyweight', addedWeightKg: 10 }, true],
    [{ kind: 'none' }, true],
    [{ kind: 'assisted', assistanceKg: 20 }, false],
  ];

  it.each(cases)('%o -> heavier is better: %s', (load, expected) => {
    expect(isHeavierBetter(load)).toBe(expected);
  });
});

describe('gram arithmetic', () => {
  it('round-trips', () => {
    for (const kg of [0, 1.25, 2.5, 20, 102.5, 142.884, 1000]) {
      expect(fromGrams(toGrams(kg))).toBe(kg);
    }
  });

  it('erases the float noise that would otherwise reach the screen', () => {
    expect(fromGrams(toGrams(1.25) + toGrams(1.25) + toGrams(2.5))).toBe(5);
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(fromGrams(toGrams(0.1) + toGrams(0.2))).toBe(0.3);
  });
});

describe('RPE and RIR are the same scale, read from opposite ends', () => {
  it('converts both ways', () => {
    expect(repsInReserve({ scale: 'rir', value: 2 })).toBe(2);
    expect(repsInReserve({ scale: 'rpe', value: 8 })).toBe(2);
    expect(ratingOfPerceivedExertion({ scale: 'rir', value: 2 })).toBe(8);
    expect(ratingOfPerceivedExertion({ scale: 'rpe', value: 8 })).toBe(8);
  });

  it('handles the half steps RPE allows', () => {
    expect(repsInReserve({ scale: 'rpe', value: 9.5 })).toBe(0.5);
  });

  it('treats RPE 10 as nothing left', () => {
    expect(repsInReserve({ scale: 'rpe', value: 10 })).toBe(0);
  });
});
