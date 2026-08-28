import { describe, expect, it } from 'vitest';
import {
  consecutiveMisses,
  nextPrescription,
  summariseSession,
  type DoubleProgressionScheme,
  type ExerciseSession,
  type LinearScheme,
  type PercentOfMaxScheme,
  type RpeScheme,
  type TimeLinearScheme,
} from './progression.js';
import type { EffortRating, PerformedSet, SetKind, SetState } from './types.js';

function set(
  weightKg: number,
  reps: number,
  state: SetState = 'completed',
  extra: { type?: SetKind; rating?: EffortRating } = {},
): PerformedSet {
  return {
    type: extra.type ?? 'working',
    state,
    load: { kind: 'external', weightKg },
    effort: { kind: 'reps', reps },
    ...(extra.rating === undefined ? {} : { effortRating: extra.rating }),
  };
}

function session(day: number, sets: readonly PerformedSet[]): ExerciseSession {
  return { performedAt: 1_700_000_000_000 + day * 86_400_000, sets };
}

const linear: LinearScheme = { kind: 'linear', targetReps: 5, incrementKg: 2.5 };
const double: DoubleProgressionScheme = {
  kind: 'double',
  repRange: { min: 8, max: 12 },
  incrementKg: 2.5,
};

describe('no history', () => {
  it('asks for a starting load rather than inventing one', () => {
    const result = nextPrescription([], linear);
    expect(result.action).toBe('first_session');
    expect(result.loadKg).toBeNull();
    expect(result.reps).toBe(5);
  });

  it('treats a session of nothing but pending sets as no history', () => {
    const result = nextPrescription([session(0, [set(100, 5, 'pending')])], linear);
    expect(result.action).toBe('first_session');
  });

  it('carries the rep range through on double progression', () => {
    const result = nextPrescription([], double);
    expect(result.reps).toBe(8);
    expect(result.repRange).toEqual({ min: 8, max: 12 });
  });
});

describe('linear progression', () => {
  it('adds the increment when every set was made', () => {
    const result = nextPrescription([session(0, [set(100, 5), set(100, 5), set(100, 5)])], linear);
    expect(result.action).toBe('add_load');
    expect(result.loadKg).toBe(102.5);
    expect(result.changeKg).toBe(2.5);
  });

  it('does not progress off a failed set', () => {
    // The whole reason `state` is three-valued. A failed set is exactly the signal
    // this rule exists to read.
    const result = nextPrescription(
      [session(0, [set(100, 5), set(100, 5), set(100, 5, 'failed')])],
      linear,
    );
    expect(result.action).toBe('repeat');
    expect(result.loadKg).toBe(100);
    expect(result.changeKg).toBe(0);
  });

  it('does not progress when the reps fell short, even with nothing marked failed', () => {
    // Someone who grinds out four reps and calls it completed has still not made 3x5.
    const result = nextPrescription([session(0, [set(100, 5), set(100, 4)])], linear);
    expect(result.action).toBe('repeat');
  });

  it('does not progress when a set was skipped', () => {
    const strict: LinearScheme = { ...linear, setsRequired: 3 };
    const result = nextPrescription([session(0, [set(100, 5), set(100, 5)])], strict);
    expect(result.action).toBe('repeat');
  });

  it('ignores warmups when deciding', () => {
    const result = nextPrescription(
      [session(0, [set(60, 8, 'completed', { type: 'warmup' }), set(100, 5), set(100, 5)])],
      linear,
    );
    expect(result.action).toBe('add_load');
    // The 100kg working sets set the load, not the 60kg warmup.
    expect(result.loadKg).toBe(102.5);
  });

  it('deloads after a run of misses, not after one bad night', () => {
    const history = [
      session(0, [set(100, 5), set(100, 4)]),
      session(1, [set(100, 5), set(100, 4)]),
    ];
    expect(nextPrescription(history, linear).action).toBe('repeat');

    const third = [...history, session(2, [set(100, 5), set(100, 3)])];
    const result = nextPrescription(third, linear);
    expect(result.action).toBe('deload');
    expect(result.loadKg).toBe(90);
    expect(result.changeKg).toBe(-10);
  });

  it('resets the miss count after one good session', () => {
    const history = [
      session(0, [set(100, 4)]),
      session(1, [set(100, 4)]),
      session(2, [set(100, 5)]),
      session(3, [set(102.5, 4)]),
    ];
    expect(nextPrescription(history, linear).action).toBe('repeat');
  });

  it('rounds the deload down onto the increment', () => {
    const miss = (day: number) => session(day, [set(102.5, 3)]);
    const result = nextPrescription([miss(0), miss(1), miss(2)], linear);
    // 102.5 - 10% = 92.25, which no gym can make. Down to 92.5 would be up, so 90.
    expect(result.loadKg).toBe(90);
  });

  it('never deloads below zero', () => {
    const miss = (day: number) => session(day, [set(1, 1)]);
    const result = nextPrescription([miss(0), miss(1), miss(2)], linear);
    expect(result.loadKg).toBeGreaterThanOrEqual(0);
  });

  it('sorts history rather than trusting the order it was handed', () => {
    const jumbled = [session(2, [set(105, 5)]), session(0, [set(100, 5)]), session(1, [set(102.5, 5)])];
    expect(nextPrescription(jumbled, linear).loadKg).toBe(107.5);
  });
});

describe('double progression', () => {
  it('adds a rep while inside the range', () => {
    const result = nextPrescription([session(0, [set(60, 8), set(60, 8)])], double);
    expect(result.action).toBe('add_reps');
    expect(result.loadKg).toBe(60);
    expect(result.reps).toBe(9);
    expect(result.changeKg).toBe(0);
  });

  it('adds weight and drops to the bottom of the range at the top of it', () => {
    const result = nextPrescription([session(0, [set(60, 12), set(60, 12)])], double);
    expect(result.action).toBe('add_load');
    expect(result.loadKg).toBe(62.5);
    expect(result.reps).toBe(8);
  });

  it('reads the worst set, not the best', () => {
    // 12 then 9 is not the top of the range. Progressing off the first set is how
    // programmes run away from the lifter.
    const result = nextPrescription([session(0, [set(60, 12), set(60, 9)])], double);
    expect(result.action).toBe('add_reps');
    expect(result.reps).toBe(10);
  });

  it('does not push a rep target past the top of the range', () => {
    const result = nextPrescription([session(0, [set(60, 11), set(60, 11)])], double);
    expect(result.reps).toBe(12);
  });

  it('treats a failed set as a miss even inside the range', () => {
    const result = nextPrescription([session(0, [set(60, 10), set(60, 8, 'failed')])], double);
    expect(result.action).toBe('repeat');
  });

  it('deloads after three failed sessions', () => {
    const miss = (day: number) => session(day, [set(60, 8, 'failed')]);
    const result = nextPrescription([miss(0), miss(1), miss(2)], double);
    expect(result.action).toBe('deload');
    expect(result.loadKg).toBe(52.5);
    expect(result.reps).toBe(8);
  });
});

describe('RPE autoregulation', () => {
  const rpe: RpeScheme = { kind: 'rpe', targetRpe: 8, reps: 5, incrementKg: 2.5 };

  it('holds when the last set landed on target', () => {
    const result = nextPrescription(
      [session(0, [set(100, 5, 'completed', { rating: { scale: 'rpe', value: 8 } })])],
      rpe,
    );
    expect(result.action).toBe('hold');
    expect(result.loadKg).toBe(100);
  });

  it('adds load when there was more in reserve than asked for', () => {
    // RPE 6 is 4 in reserve against a target of 2: two points of headroom, ~6%.
    const result = nextPrescription(
      [session(0, [set(100, 5, 'completed', { rating: { scale: 'rpe', value: 6 } })])],
      rpe,
    );
    expect(result.action).toBe('add_load');
    expect(result.loadKg).toBe(105);
  });

  it('cuts load when the set was harder than asked for', () => {
    const result = nextPrescription(
      [session(0, [set(100, 5, 'completed', { rating: { scale: 'rpe', value: 10 } })])],
      rpe,
    );
    expect(result.action).toBe('deload');
    expect(result.loadKg).toBe(95);
  });

  it('reads RIR and RPE as the same scale', () => {
    const viaRir = nextPrescription(
      [session(0, [set(100, 5, 'completed', { rating: { scale: 'rir', value: 4 } })])],
      rpe,
    );
    const viaRpe = nextPrescription(
      [session(0, [set(100, 5, 'completed', { rating: { scale: 'rpe', value: 6 } })])],
      rpe,
    );
    expect(viaRir.loadKg).toBe(viaRpe.loadKg);
  });

  it('treats half a point as noise', () => {
    const result = nextPrescription(
      [session(0, [set(100, 5, 'completed', { rating: { scale: 'rpe', value: 8.5 } })])],
      rpe,
    );
    expect(result.action).toBe('hold');
  });

  it('repeats rather than guessing when no rating was logged', () => {
    const result = nextPrescription([session(0, [set(100, 5)])], rpe);
    expect(result.action).toBe('hold');
    expect(result.reason).toContain('No RPE');
    expect(result.loadKg).toBe(100);
  });

  it('lets a missed set override an optimistic rating', () => {
    // Someone who fails a set and still logs RPE 7 is reporting how the reps they
    // *made* felt, not that there was room to add weight.
    const result = nextPrescription(
      [session(0, [set(100, 5, 'failed', { rating: { scale: 'rpe', value: 7 } })])],
      rpe,
    );
    expect(result.action).toBe('repeat');
    expect(result.loadKg).toBe(100);
  });

  it('reads the last attempted set, not the heaviest', () => {
    const result = nextPrescription(
      [
        session(0, [
          set(100, 5, 'completed', { rating: { scale: 'rpe', value: 6 } }),
          set(80, 8, 'completed', { rating: { scale: 'rpe', value: 8 } }),
        ]),
      ],
      rpe,
    );
    // Last rating is on target, so hold — at the top load of 100.
    expect(result.action).toBe('hold');
    expect(result.loadKg).toBe(100);
  });
});

describe('percentage of an estimated max', () => {
  const scheme: PercentOfMaxScheme = { kind: 'percent_1rm', percent: 80, reps: 3, incrementKg: 2.5 };

  it('prescribes the percentage, rounded onto the increment', () => {
    // 100x5 by Epley is 116.67; 80% is 93.33; the nearest 2.5 is 92.5.
    const result = nextPrescription([session(0, [set(100, 5)])], scheme);
    expect(result.loadKg).toBe(92.5);
    expect(result.reason).toContain('80%');
  });

  it('uses the best max on record, not the most recent one', () => {
    const history = [session(0, [set(120, 5)]), session(1, [set(80, 5)])];
    const best = nextPrescription(history, scheme);
    const recent = nextPrescription([session(1, [set(80, 5)])], scheme);
    expect(best.loadKg as number).toBeGreaterThan(recent.loadKg as number);
  });

  it('never builds a max out of a failed set', () => {
    const result = nextPrescription([session(0, [set(200, 1, 'failed')])], scheme);
    expect(result.action).toBe('first_session');
    expect(result.loadKg).toBeNull();
  });

  it('never builds a max out of a warmup', () => {
    const result = nextPrescription(
      [session(0, [set(60, 10, 'completed', { type: 'warmup' })])],
      scheme,
    );
    expect(result.action).toBe('first_session');
  });
});

describe('timed holds', () => {
  const scheme: TimeLinearScheme = { kind: 'time_linear', targetSec: 60, incrementSec: 10 };

  function hold(day: number, seconds: number, state: SetState = 'completed'): ExerciseSession {
    return session(day, [
      { type: 'working', state, load: { kind: 'none' }, effort: { kind: 'duration', durationSec: seconds } },
    ]);
  }

  it('extends the target once the hold is made', () => {
    const result = nextPrescription([hold(0, 60)], scheme);
    expect(result.action).toBe('add_time');
    expect(result.durationSec).toBe(70);
  });

  it('repeats when it was not made', () => {
    expect(nextPrescription([hold(0, 45)], scheme).action).toBe('repeat');
  });

  it('cuts the target after a run of misses', () => {
    const result = nextPrescription([hold(0, 40), hold(1, 42), hold(2, 38)], scheme);
    expect(result.action).toBe('deload');
    expect(result.durationSec).toBe(54);
  });
});

describe('summariseSession', () => {
  it('reads the worst rep count and the top load', () => {
    const summary = summariseSession(session(0, [set(100, 5), set(100, 3), set(60, 12)]));
    expect(summary.topLoadKg).toBe(100);
    expect(summary.minReps).toBe(3);
    expect(summary.maxReps).toBe(12);
    expect(summary.attemptedSets).toBe(3);
  });

  it('drops warmups and pending sets', () => {
    const summary = summariseSession(
      session(0, [set(200, 1, 'completed', { type: 'warmup' }), set(100, 5, 'pending'), set(100, 5)]),
    );
    expect(summary.topLoadKg).toBe(100);
    expect(summary.attemptedSets).toBe(1);
  });

  it('flags a failed set both ways', () => {
    const summary = summariseSession(session(0, [set(100, 5), set(100, 3, 'failed')]));
    expect(summary.anyFailed).toBe(true);
    expect(summary.allCompleted).toBe(false);
  });

  it('takes the best e1RM from completed sets only', () => {
    const summary = summariseSession(session(0, [set(100, 5), set(140, 1, 'failed')]));
    // Epley on 100x5 = 116.67. The failed 140kg single does not count, however heavy.
    expect(summary.bestE1rmKg).toBeCloseTo(116.67, 1);
  });

  it('is empty rather than throwing on a session with nothing in it', () => {
    const summary = summariseSession(session(0, []));
    expect(summary.attemptedSets).toBe(0);
    expect(summary.topLoadKg).toBeNull();
    expect(summary.allCompleted).toBe(false);
  });

  it('resolves bodyweight loads from the session context', () => {
    const pullUps: ExerciseSession = {
      performedAt: 1,
      context: { bodyweightKg: 80 },
      sets: [
        {
          type: 'working',
          state: 'completed',
          load: { kind: 'bodyweight', addedWeightKg: 10 },
          effort: { kind: 'reps', reps: 5 },
        },
      ],
    };
    expect(summariseSession(pullUps).topLoadKg).toBe(90);
  });
});

describe('consecutiveMisses', () => {
  it('counts back to the last success', () => {
    const summaries = [
      summariseSession(session(0, [set(100, 5)])),
      summariseSession(session(1, [set(100, 5, 'failed')])),
      summariseSession(session(2, [set(100, 5, 'failed')])),
    ];
    expect(consecutiveMisses(summaries)).toBe(2);
  });

  it('skips sessions with nothing attempted rather than counting them as misses', () => {
    const summaries = [
      summariseSession(session(0, [set(100, 5, 'failed')])),
      summariseSession(session(1, [set(100, 5, 'pending')])),
      summariseSession(session(2, [set(100, 5, 'failed')])),
    ];
    expect(consecutiveMisses(summaries)).toBe(2);
  });

  it('is zero when the last session was a success', () => {
    expect(consecutiveMisses([summariseSession(session(0, [set(100, 5)]))])).toBe(0);
  });
});

describe('every prescription is usable as-is', () => {
  const histories: ExerciseSession[][] = [
    [],
    [session(0, [set(100, 5)])],
    [session(0, [set(100, 3, 'failed')])],
    [session(0, [set(100, 4)]), session(1, [set(100, 4)]), session(2, [set(100, 4)])],
  ];

  it.each(histories)('linear gives a load on the increment grid (%#)', (...history) => {
    const result = nextPrescription(history as ExerciseSession[], linear);
    if (result.loadKg === null) return;
    expect(Math.round((result.loadKg / 2.5) * 1e6) % 1e6).toBe(0);
  });

  it.each(histories)('reason is one short line (%#)', (...history) => {
    for (const scheme of [linear, double] as const) {
      const result = nextPrescription(history as ExerciseSession[], scheme);
      expect(result.reason.length).toBeGreaterThan(0);
      // No paragraphs in the workout flow — this is read between sets.
      expect(result.reason.length).toBeLessThanOrEqual(40);
      expect(result.reason).not.toContain('\n');
    }
  });
});
