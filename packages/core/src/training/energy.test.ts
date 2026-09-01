import { describe, expect, it } from 'vitest';
import { MAX_CREDITED_MINUTES, RESISTANCE_TRAINING_MET, sessionEnergyKcal } from './energy';

describe('sessionEnergyKcal', () => {
  it('applies the standard MET conversion', () => {
    // 3.5 MET x 3.5 ml x 80 kg / 200 x 60 min = 294 kcal
    expect(sessionEnergyKcal({ durationSec: 3600, bodyweightKg: 80 })).toBe(294);
  });

  it('scales with bodyweight and with time', () => {
    const hour80 = sessionEnergyKcal({ durationSec: 3600, bodyweightKg: 80 }) ?? 0;
    expect(sessionEnergyKcal({ durationSec: 3600, bodyweightKg: 160 })).toBe(hour80 * 2);
    expect(sessionEnergyKcal({ durationSec: 1800, bodyweightKg: 80 })).toBe(hour80 / 2);
  });

  /*
   * `null`, not `0`. A session with no recorded bodyweight is UNKNOWN, not free —
   * the same distinction the summary already draws for volume, where printing 0
   * would tell a lifter they lifted nothing. A figure invented from a default
   * weight would be indistinguishable on screen from a measured one.
   */
  it('returns null rather than a number it cannot support', () => {
    expect(sessionEnergyKcal({ durationSec: 3600 })).toBeNull();
    expect(sessionEnergyKcal({ durationSec: 3600, bodyweightKg: 0 })).toBeNull();
    expect(sessionEnergyKcal({ durationSec: 3600, bodyweightKg: Number.NaN })).toBeNull();
    expect(sessionEnergyKcal({ durationSec: 0, bodyweightKg: 80 })).toBeNull();
    expect(sessionEnergyKcal({ durationSec: -60, bodyweightKg: 80 })).toBeNull();
  });

  it('stops crediting a phone left in a locker', () => {
    const capped = sessionEnergyKcal({ durationSec: MAX_CREDITED_MINUTES * 60, bodyweightKg: 80 });
    const absurd = sessionEnergyKcal({ durationSec: 9 * 3600, bodyweightKg: 80 });
    expect(absurd).toBe(capped);
  });

  it('uses the conservative end of the Compendium range by default', () => {
    // Every incentive points at over-estimating, and over-estimating is the
    // error that does harm. 3.5 is "light or moderate effort, general" —
    // logged strength training is mostly rest.
    expect(RESISTANCE_TRAINING_MET).toBe(3.5);
    const vigorous = sessionEnergyKcal({ durationSec: 3600, bodyweightKg: 80, met: 6 }) ?? 0;
    const dflt = sessionEnergyKcal({ durationSec: 3600, bodyweightKg: 80 }) ?? 0;
    expect(dflt).toBeLessThan(vigorous);
  });
});
