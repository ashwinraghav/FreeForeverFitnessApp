import type { LocalDate, SetId, SortKey, WorkoutExerciseId } from '@freeforever/data';
import { describe, expect, it } from 'vitest';

import { STARTER_CATALOGUE } from '../catalogue/starter.js';
import { toExerciseRef } from '../catalogue/types.js';
import {
  bestsFor,
  defaultSchemeFor,
  deriveSchemeFor,
  FALLBACK_REP_RANGE,
  progressionHistory,
  recordsThisSession,
  suggestionFor,
  suggestionLine,
} from './coaching.js';
import type { CompletedSession } from './history.js';
import type { DraftExercise, DraftSet, DraftWorkout } from './types.js';

const bench = toExerciseRef(STARTER_CATALOGUE.find((e) => e.id === 'bench-press')!);
const plank = toExerciseRef(STARTER_CATALOGUE.find((e) => e.id === 'plank')!);

const DAY = 86_400_000;
const NOW = 1_760_000_000_000;

function set(index: number, weightKg: number, reps: number, state: DraftSet['state'] = 'completed'): DraftSet {
  return {
    id: `s${index}` as SetId,
    sortKey: String.fromCharCode(97 + index) as SortKey,
    type: 'working',
    state,
    loadKind: 'external',
    effortKind: 'reps',
    weightKg,
    reps,
    durationSec: null,
    distanceM: null,
    performedAt: NOW as never,
  };
}

function exercise(sets: readonly DraftSet[], ref = bench): DraftExercise {
  return { id: 'x0' as WorkoutExerciseId, sortKey: 'a' as SortKey, exercise: ref, sets };
}

function session(startedAt: number, sets: readonly DraftSet[], ref = bench): CompletedSession {
  return {
    id: `w${startedAt}`,
    localDate: '2026-08-21' as LocalDate,
    startedAt,
    exercises: [exercise(sets, ref)],
  };
}

function workout(exercises: readonly DraftExercise[]): DraftWorkout {
  return {
    id: 'w1',
    status: 'in_progress',
    title: 'Session',
    startedAt: NOW,
    localDate: '2026-08-28' as LocalDate,
    tzOffsetMinutes: 0,
    exercises,
  } as DraftWorkout;
}

describe('defaults', () => {
  it('picks double progression for rep work — it fails most safely', () => {
    const scheme = defaultSchemeFor(bench, 2.5);
    expect(scheme.kind).toBe('double');
  });

  it('picks a time scheme for a timed hold', () => {
    expect(defaultSchemeFor(plank, 2.5).kind).toBe('time_linear');
  });
});

describe('progressionHistory', () => {
  it('is oldest first, which is what the rules expect', () => {
    const sessions = [
      session(NOW - 14 * DAY, [set(0, 60, 8)]),
      session(NOW - 7 * DAY, [set(0, 60, 10)]),
    ];
    const history = progressionHistory(bench, sessions);
    expect(history.map((entry) => entry.performedAt)).toEqual([NOW - 14 * DAY, NOW - 7 * DAY]);
  });

  it('takes at most one entry per session', () => {
    expect(progressionHistory(bench, [session(NOW, [set(0, 60, 8), set(1, 60, 8)])])).toHaveLength(1);
  });

  it('bounds how far back it reads', () => {
    const sessions = Array.from({ length: 20 }, (_, index) =>
      session(NOW - index * DAY, [set(0, 60, 8)]),
    );
    expect(progressionHistory(bench, sessions).length).toBeLessThanOrEqual(8);
  });

  it('ignores other exercises entirely', () => {
    expect(progressionHistory(plank, [session(NOW, [set(0, 60, 8)])])).toEqual([]);
  });
});

describe('the suggestion', () => {
  it('adds a rep while inside the range', () => {
    const suggestion = suggestionFor(bench, [session(NOW - DAY, [set(0, 60, 8), set(1, 60, 8)])], 2.5);
    expect(suggestion.action).toBe('add_reps');
    expect(suggestionLine(suggestion)).toBe('Next: 60kg x9 — Same weight — go for 9');
  });

  it('adds weight at the top of the range', () => {
    // The range is derived, so reaching the top means reaching two above the lifter's
    // usual: sets of 8 progressed to 10.
    const history = [
      session(NOW - 3 * DAY, [set(0, 60, 8), set(1, 60, 8)]),
      session(NOW - 2 * DAY, [set(0, 60, 8), set(1, 60, 8)]),
      session(NOW - DAY, [set(0, 60, 10), set(1, 60, 10)]),
    ];
    // Usual is 8, so the range is 8-10 and last session's tens are the top of it.
    expect(deriveSchemeFor(bench, history, 2.5)).toMatchObject({ repRange: { min: 8, max: 10 } });
    const suggestion = suggestionFor(bench, history, 2.5);
    expect(suggestion.action).toBe('add_load');
    expect(suggestionLine(suggestion)).toContain('62.5kg');
  });

  it('says nothing at all on a first session', () => {
    // Better an empty line than a line that says "pick a load" to someone who is
    // already holding one.
    expect(suggestionLine(suggestionFor(bench, [], 2.5))).toBeNull();
  });

  it('never suggests progressing off a missed set', () => {
    const suggestion = suggestionFor(
      bench,
      [session(NOW - DAY, [set(0, 60, 12), set(1, 60, 8, 'failed')])],
      2.5,
    );
    expect(suggestion.action).toBe('repeat');
    expect(suggestionLine(suggestion)).toContain('go again');
  });

  it('rounds onto the gym’s increment', () => {
    const history = [
      session(NOW - 3 * DAY, [set(0, 60, 8)]),
      session(NOW - 2 * DAY, [set(0, 60, 8)]),
      session(NOW - DAY, [set(0, 60, 10)]),
    ];
    expect(suggestionFor(bench, history, 1.25).loadKg).toBe(61.25);
  });

  it('is one short line, never a paragraph', () => {
    const line = suggestionLine(suggestionFor(bench, [session(NOW - DAY, [set(0, 60, 8)])], 2.5));
    expect(line).not.toBeNull();
    expect((line as string).length).toBeLessThanOrEqual(60);
    expect(line).not.toContain('\n');
  });
});

describe('personal bests folded out of local history', () => {
  it('finds the heaviest and the best estimated max', () => {
    const bests = bestsFor(bench, [
      session(NOW - 14 * DAY, [set(0, 90, 5)]),
      session(NOW - 7 * DAY, [set(0, 100, 5)]),
    ]);
    expect(bests.heaviest_weight).toBe(100);
    expect(bests.best_e1rm).toBeCloseTo(116.67, 1);
  });

  it('never counts a failed set', () => {
    const bests = bestsFor(bench, [session(NOW - DAY, [set(0, 200, 1, 'failed')])]);
    expect(bests.heaviest_weight).toBeUndefined();
  });

  it('is empty with no history', () => {
    expect(bestsFor(bench, [])).toEqual({});
  });
});

describe('records set in the current session', () => {
  it('reports a set that beat the held best', () => {
    const history = [session(NOW - 7 * DAY, [set(0, 100, 5)])];
    const live = exercise([set(0, 105, 5)]);
    const types = recordsThisSession(live, workout([live]), history).map((record) => record.type);
    expect(types).toContain('heaviest_weight');
    expect(types).toContain('best_e1rm');
  });

  it('reports nothing for a session that beat nothing', () => {
    const history = [session(NOW - 7 * DAY, [set(0, 100, 5), set(1, 100, 5)])];
    const live = exercise([set(0, 90, 5)]);
    expect(recordsThisSession(live, workout([live]), history)).toEqual([]);
  });

  it('reports nothing for a set that has not been logged yet', () => {
    const history = [session(NOW - 7 * DAY, [set(0, 100, 5)])];
    const live = exercise([set(0, 200, 5, 'pending')]);
    expect(recordsThisSession(live, workout([live]), history)).toEqual([]);
  });

  it('reports nothing for a missed heavy attempt', () => {
    const history = [session(NOW - 7 * DAY, [set(0, 100, 5)])];
    const live = exercise([set(0, 200, 1, 'failed')]);
    expect(recordsThisSession(live, workout([live]), history)).toEqual([]);
  });
});

describe('the rep range is the lifter’s, not a constant', () => {
  const rangeOf = (sessions: CompletedSession[]) => {
    const scheme = deriveSchemeFor(bench, sessions, 2.5);
    return scheme.kind === 'double' ? scheme.repRange : null;
  };

  it('reads the range off the reps the lifter actually does', () => {
    // Straight fives get 5-7, not 8-12.
    expect(rangeOf([session(NOW - DAY, [set(0, 100, 5), set(1, 100, 5)])])).toEqual({
      min: 5,
      max: 7,
    });
  });

  it('follows a higher-rep lifter up', () => {
    expect(rangeOf([session(NOW - DAY, [set(0, 30, 12), set(1, 30, 12)])])).toEqual({
      min: 12,
      max: 14,
    });
  });

  it('falls back only when there is nothing to read', () => {
    expect(rangeOf([])).toEqual(FALLBACK_REP_RANGE);
    expect(defaultSchemeFor(bench, 2.5)).toMatchObject({ repRange: FALLBACK_REP_RANGE });
  });

  it('ignores failed and warmup sets when reading the usual rep count', () => {
    const sessions = [
      session(NOW - DAY, [set(0, 100, 5), set(1, 100, 5), set(2, 100, 3, 'failed')]),
    ];
    expect(rangeOf(sessions)).toEqual({ min: 5, max: 7 });
  });

  it('never tells a lifter running fives to chase eight', () => {
    // The bug this exists for, seen in the browser: a 3x5 bench with one missed set
    // per session was told "Next: 90kg x8 — 3 misses — cut 10%", because a blanket
    // 8-12 range read every five-rep session as a failure to reach twelve.
    const threeByFive = [
      session(NOW - 3 * DAY, [set(0, 100, 5), set(1, 100, 5), set(2, 100, 4, 'failed')]),
      session(NOW - 2 * DAY, [set(0, 100, 5), set(1, 100, 5), set(2, 100, 4, 'failed')]),
      session(NOW - DAY, [set(0, 100, 5), set(1, 100, 5), set(2, 100, 4, 'failed')]),
    ];
    const line = suggestionLine(suggestionFor(bench, threeByFive, 2.5));
    expect(line).not.toContain('x8');
    expect(rangeOf(threeByFive)).toEqual({ min: 5, max: 7 });
  });
});
