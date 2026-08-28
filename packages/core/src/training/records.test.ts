import { describe, expect, it } from 'vitest';
import { beatsRecord, detectRecords, type CandidateSet, type CurrentBests } from './records.js';
import type { SetKind, SetState } from './types.js';

function set(
  setId: string,
  weightKg: number,
  reps: number,
  state: SetState = 'completed',
  type: SetKind = 'working',
): CandidateSet {
  return {
    setId,
    type,
    state,
    load: { kind: 'external', weightKg },
    effort: { kind: 'reps', reps },
  };
}

function typesOf(sets: readonly CandidateSet[], current: CurrentBests = {}): string[] {
  return detectRecords(sets, current).achievements.map((a) => a.type);
}

describe('a first session sets everything it can', () => {
  it('claims every applicable record with no previous value', () => {
    const { achievements } = detectRecords([set('a', 100, 5)]);
    expect(achievements.map((a) => a.type)).toEqual([
      'heaviest_weight',
      'best_e1rm',
      'most_reps',
      'best_set_volume',
      'best_session_volume',
    ]);
    for (const achievement of achievements) {
      expect(achievement.previousValue).toBeUndefined();
    }
  });

  it('attributes set-scoped records to the set', () => {
    const { achievements } = detectRecords([set('a', 100, 5)]);
    const heaviest = achievements.find((a) => a.type === 'heaviest_weight');
    expect(heaviest?.setId).toBe('a');
    expect(heaviest?.value).toBe(100);
    expect(heaviest?.reps).toBe(5);
  });

  it('leaves session volume unattributed, because it is not one set', () => {
    // A PR timeline that links a session total to an arbitrary set is a lie the user
    // will notice the first time they tap it.
    const { achievements } = detectRecords([set('a', 100, 5), set('b', 100, 5)]);
    const session = achievements.find((a) => a.type === 'best_session_volume');
    expect(session?.setId).toBeUndefined();
    expect(session?.value).toBe(1000);
  });
});

describe('ineligible sets never set a record', () => {
  it('a failed set does not, however heavy', () => {
    // The rule the whole three-state design exists for.
    expect(typesOf([set('a', 250, 1, 'failed')])).toEqual([]);
  });

  it('a warmup does not, however heavy', () => {
    expect(typesOf([set('a', 250, 1, 'completed', 'warmup')])).toEqual([]);
  });

  it('a pending set does not', () => {
    expect(typesOf([set('a', 250, 1, 'pending')])).toEqual([]);
  });

  it('a failed heavy single does not spoil a completed lighter one', () => {
    const { achievements } = detectRecords([set('a', 100, 5), set('b', 250, 1, 'failed')]);
    const heaviest = achievements.find((a) => a.type === 'heaviest_weight');
    expect(heaviest?.value).toBe(100);
    expect(heaviest?.setId).toBe('a');
  });

  it('excludes failed work from session volume', () => {
    const { achievements } = detectRecords([set('a', 100, 5), set('b', 100, 5, 'failed')]);
    expect(achievements.find((a) => a.type === 'best_session_volume')?.value).toBe(500);
  });
});

describe('beating what is already held', () => {
  const current: CurrentBests = {
    heaviest_weight: 100,
    best_e1rm: 120,
    most_reps: 10,
    best_set_volume: 600,
    best_session_volume: 2000,
  };

  it('reports only what actually improved', () => {
    // 105x5: heavier than 100 and a better e1RM than 120, but 5 reps is not 10 and
    // 525kg is not 600, and one set is not 2000kg of session volume.
    expect(typesOf([set('a', 105, 5)], current)).toEqual(['heaviest_weight', 'best_e1rm']);
  });

  it('records what was beaten', () => {
    const { achievements } = detectRecords([set('a', 105, 5)], current);
    expect(achievements[0]?.previousValue).toBe(100);
  });

  it('treats equalling a record as not beating it', () => {
    // Matching your best is not a personal record, and a log that says otherwise
    // devalues the badge.
    expect(typesOf([set('a', 100, 5)], { heaviest_weight: 100 })).not.toContain('heaviest_weight');
  });

  it('is silent on a session that beat nothing', () => {
    expect(typesOf([set('a', 60, 5)], current)).toEqual([]);
  });
});

describe('the best set in a session wins its type', () => {
  it('keeps the heaviest, not the last', () => {
    const { achievements } = detectRecords([set('a', 120, 1), set('b', 100, 5)]);
    expect(achievements.find((a) => a.type === 'heaviest_weight')?.setId).toBe('a');
    // A true single is its own max, so 120 also wins best_e1rm over 100x5's 116.67.
    expect(achievements.find((a) => a.type === 'best_e1rm')?.setId).toBe('a');
    // Set volume and rep count go the other way: 500kg and 5 reps against 120kg and 1.
    expect(achievements.find((a) => a.type === 'best_set_volume')?.setId).toBe('b');
    expect(achievements.find((a) => a.type === 'most_reps')?.setId).toBe('b');
  });

  it('keeps the earlier set on a tie', () => {
    const { achievements } = detectRecords([set('a', 100, 5), set('b', 100, 5)]);
    expect(achievements.find((a) => a.type === 'heaviest_weight')?.setId).toBe('a');
  });
});

describe('rep maxes', () => {
  it('records the exact rep counts, and only the tracked ones', () => {
    const { repMaxKgByReps } = detectRecords([set('a', 100, 5), set('b', 80, 8), set('c', 90, 7)]);
    expect(repMaxKgByReps).toEqual({ '5': 100, '8': 80 });
    // 7 is not in TRACKED_REP_MAXES, so the 90x7 is not filed as a rep max.
    expect(repMaxKgByReps['7']).toBeUndefined();
  });

  it('does not interpolate — an eight-rep set says nothing about a five-rep max', () => {
    const { repMaxKgByReps } = detectRecords([set('a', 80, 8)]);
    expect(Object.keys(repMaxKgByReps)).toEqual(['8']);
  });

  it('only improves on what is held', () => {
    const { repMaxKgByReps } = detectRecords([set('a', 95, 5)], {}, { '5': 100 });
    expect(repMaxKgByReps).toEqual({});
  });

  it('keeps the heaviest of two sets at the same rep count', () => {
    const { repMaxKgByReps } = detectRecords([set('a', 95, 5), set('b', 105, 5)]);
    expect(repMaxKgByReps).toEqual({ '5': 105 });
  });

  it('ignores failed and warmup sets', () => {
    const { repMaxKgByReps } = detectRecords([
      set('a', 200, 5, 'failed'),
      set('b', 150, 5, 'completed', 'warmup'),
    ]);
    expect(repMaxKgByReps).toEqual({});
  });
});

describe('timed and distance work', () => {
  it('records a longest hold', () => {
    const plank: CandidateSet = {
      setId: 'a',
      type: 'working',
      state: 'completed',
      load: { kind: 'none' },
      effort: { kind: 'duration', durationSec: 90 },
    };
    const { achievements } = detectRecords([plank], { best_duration: 60 });
    expect(achievements).toHaveLength(1);
    expect(achievements[0]?.type).toBe('best_duration');
    expect(achievements[0]?.value).toBe(90);
    expect(achievements[0]?.previousValue).toBe(60);
  });

  it('records a furthest distance and carries the time with it', () => {
    const row: CandidateSet = {
      setId: 'a',
      type: 'working',
      state: 'completed',
      load: { kind: 'none' },
      effort: { kind: 'distance', distanceM: 2000, durationSec: 420 },
    };
    const { achievements } = detectRecords([row]);
    const best = achievements.find((a) => a.type === 'best_distance');
    expect(best?.value).toBe(2000);
    expect(best?.durationSec).toBe(420);
  });

  it('does not claim a weight record for an unloaded hold', () => {
    const plank: CandidateSet = {
      setId: 'a',
      type: 'working',
      state: 'completed',
      load: { kind: 'none' },
      effort: { kind: 'duration', durationSec: 90 },
    };
    expect(typesOf([plank])).toEqual(['best_duration']);
  });
});

describe('bodyweight and assisted work', () => {
  it('needs a bodyweight before it can claim a load record', () => {
    const pullUp: CandidateSet = {
      setId: 'a',
      type: 'working',
      state: 'completed',
      load: { kind: 'bodyweight', addedWeightKg: 20 },
      effort: { kind: 'reps', reps: 5 },
    };
    expect(detectRecords([pullUp]).achievements).toEqual([]);
    expect(detectRecords([pullUp], {}, {}, { bodyweightKg: 80 }).achievements.length).toBeGreaterThan(0);
  });

  it('treats less assistance as a heavier lift', () => {
    const assisted = (setId: string, assistanceKg: number): CandidateSet => ({
      setId,
      type: 'working',
      state: 'completed',
      load: { kind: 'assisted', assistanceKg },
      effort: { kind: 'reps', reps: 5 },
    });

    const { achievements } = detectRecords(
      [assisted('a', 40)],
      { heaviest_weight: 35 },
      {},
      { bodyweightKg: 80 },
    );
    // 80 - 40 = 40kg of the lifter's own weight, which beats a held 35.
    expect(achievements.find((a) => a.type === 'heaviest_weight')?.value).toBe(40);
  });
});

describe('beatsRecord — the mid-set question', () => {
  it('answers for one set without folding the session', () => {
    expect(beatsRecord(set('a', 105, 5), 'heaviest_weight', { heaviest_weight: 100 })).toBe(true);
    expect(beatsRecord(set('a', 95, 5), 'heaviest_weight', { heaviest_weight: 100 })).toBe(false);
  });

  it('is false for a set that just failed, whatever was on the bar', () => {
    expect(beatsRecord(set('a', 200, 1, 'failed'), 'heaviest_weight', { heaviest_weight: 100 })).toBe(
      false,
    );
  });
});

describe('degenerate input', () => {
  it('an empty session claims nothing', () => {
    expect(detectRecords([])).toEqual({ achievements: [], repMaxKgByReps: {} });
  });

  it('a zero-weight set claims no weight record', () => {
    expect(typesOf([set('a', 0, 5)])).toEqual([]);
  });

  it('a zero-rep set claims only the weight it held', () => {
    expect(typesOf([set('a', 100, 0)])).toEqual(['heaviest_weight']);
  });

  it('an assisted rep where the machine took everything claims nothing', () => {
    const fullyAssisted = {
      setId: 'a',
      type: 'working',
      state: 'completed',
      load: { kind: 'assisted', assistanceKg: 100 },
      effort: { kind: 'reps', reps: 5 },
    } as const;
    expect(detectRecords([fullyAssisted], {}, {}, { bodyweightKg: 80 }).achievements).toEqual([]);
  });

  it('achievements come back in a stable order', () => {
    const once = typesOf([set('a', 100, 5), set('b', 90, 8)]);
    const twice = typesOf([set('b', 90, 8), set('a', 100, 5)]);
    expect(once).toEqual(twice);
  });
});
