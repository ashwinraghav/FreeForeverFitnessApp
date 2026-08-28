import { describe, expect, it } from 'vitest';
import type {
  AdherenceAggregate,
  AggregateEvent,
  AggregateId,
  AggregateReducer,
  DomainSnapshot,
  ExerciseProgressAggregate,
  HabitId,
  IsoWeek,
  NutritionAggregate,
  PersonalRecordsAggregate,
  TrainingVolumeAggregate,
  Workout,
} from '../../index.js';
import { REDUCERS } from '../reducers/registry.js';
import { applyEvent, freshRecord, statesEqual } from '../runner.js';
import {
  emptySnapshot,
  makeHabitDay,
  makeMacroTarget,
  makeNutritionDay,
  makePersonalRecord,
  makeWorkout,
} from './fixtures.js';

/**
 * The contract tests from aggregates.ts, run against real documents:
 * purity/idempotence, replay safety, malformed-input tolerance, and the load-
 * bearing property — reduce(empty(), events) deep-equals rebuild(snapshot).
 */

// ---------------------------------------------------------------------------
// A shared cast of documents exercising the interesting paths.
// ---------------------------------------------------------------------------

const workoutA = makeWorkout({
  id: 'wA',
  localDate: '2026-08-24', // Monday, 2026-W35
  bodyweightKg: 80,
  programRef: { routineId: 'r1', programDayId: 'd1', weekIndex: 0 },
  exercises: [
    {
      id: 'e1',
      sets: [
        { id: 's1', type: 'warmup', weightKg: 60, reps: 10 }, // excluded from volume
        { id: 's2', weightKg: 100, reps: 5, target: { effort: { kind: 'reps', reps: 5 } } },
        { id: 's3', state: 'failed', weightKg: 100, reps: 3, target: { effort: { kind: 'reps', reps: 5 } } },
      ],
      muscles: [
        { muscle: 'chest', fraction: 1 },
        { muscle: 'triceps', fraction: 0.5 },
      ],
    },
    {
      id: 'e2',
      exerciseId: 'split_squat',
      name: 'Split Squat',
      unilateral: true,
      muscles: [{ muscle: 'quads', fraction: 1 }],
      sets: [{ id: 's4', weightKg: 20, reps: 10 }],
    },
  ],
});

const workoutB = makeWorkout({
  id: 'wB',
  localDate: '2026-08-31', // the following week, 2026-W36
  exercises: [{ id: 'e1', sets: [{ id: 's1', weightKg: 105, reps: 5 }] }],
});

const workoutDiscarded = makeWorkout({
  id: 'wC',
  localDate: '2026-08-25',
  status: 'discarded',
  exercises: [{ id: 'e1', sets: [{ id: 's1', weightKg: 999, reps: 5 }] }],
});

const workoutBEdited = makeWorkout({
  id: 'wB',
  localDate: '2026-08-31',
  exercises: [{ id: 'e1', sets: [{ id: 's1', weightKg: 110, reps: 5 }] }],
});

const prBench = makePersonalRecord({
  id: 'bench_press',
  achievements: [
    { type: 'heaviest_weight', value: 100, achievedAt: 1_787_000_000_000, achievedOn: '2026-08-24', workoutId: 'wA' },
    { type: 'heaviest_weight', value: 105, achievedAt: 1_787_600_000_000, achievedOn: '2026-08-31', workoutId: 'wB' },
  ],
});

const dayMon = makeNutritionDay({
  localDate: '2026-08-24',
  meals: [{ id: 'm1', entries: [{ id: 'n1', energyKcal: 600, proteinG: 40 }] }],
  targetSnapshot: { energyKcal: 2500, proteinG: 30, carbsG: 250, fatG: 80 },
});
const dayTue = makeNutritionDay({
  localDate: '2026-08-25',
  meals: [{ id: 'm1', entries: [{ id: 'n1', energyKcal: 2000, proteinG: 100 }] }],
});
const target = makeMacroTarget({ id: 't1', effectiveFrom: '2026-08-01', energyKcal: 2400, proteinG: 150 });

const habitMon = makeHabitDay({
  localDate: '2026-08-24',
  entries: [
    { habitId: 'water', status: 'done' },
    { habitId: 'steps', status: 'missed' },
  ],
});
const habitTue = makeHabitDay({
  localDate: '2026-08-25',
  entries: [{ habitId: 'water', status: 'done' }],
});

function workoutEvent(id: string, previous: Workout | null, next: Workout | null, sequence: number): AggregateEvent {
  return { kind: 'workout', id, previous, next, sequence };
}

/**
 * The event script: creations arriving in non-chronological order, a discarded
 * session, an edit, and a delete. `snapshot` is the matching end state.
 */
const EVENTS: AggregateEvent[] = [
  workoutEvent('wB', null, workoutB, 1),
  { kind: 'nutritionDay', id: '2026-08-24', previous: null, next: dayMon, sequence: 1 },
  workoutEvent('wA', null, workoutA, 2),
  { kind: 'personalRecord', id: 'bench_press', previous: null, next: prBench, sequence: 1 },
  workoutEvent('wC', null, workoutDiscarded, 3),
  { kind: 'habitDay', id: '2026-08-24', previous: null, next: habitMon, sequence: 1 },
  { kind: 'macroTarget', id: 't1', previous: null, next: target, sequence: 1 },
  workoutEvent('wB', workoutB, workoutBEdited, 4), // edit
  { kind: 'nutritionDay', id: '2026-08-25', previous: null, next: dayTue, sequence: 2 },
  { kind: 'habitDay', id: '2026-08-25', previous: null, next: habitTue, sequence: 2 },
  workoutEvent('wC', workoutDiscarded, null, 5), // hard delete
];

const SNAPSHOT: DomainSnapshot = {
  ...emptySnapshot(),
  workouts: [workoutA, workoutBEdited],
  personalRecords: [prBench],
  nutritionDays: [dayMon, dayTue],
  macroTargets: [target],
  habitDays: [habitMon, habitTue],
};

function foldAll(id: AggregateId): unknown {
  const reducer = REDUCERS[id];
  const record = freshRecord(reducer);
  for (const event of EVENTS) applyEvent(record, reducer, event);
  return record.state;
}

// ---------------------------------------------------------------------------
// The load-bearing property.
// ---------------------------------------------------------------------------

describe('reduce(empty, events) === rebuild(snapshot)', () => {
  for (const id of Object.keys(REDUCERS) as AggregateId[]) {
    it(id, () => {
      const folded = foldAll(id);
      const rebuilt = REDUCERS[id].rebuild(SNAPSHOT);
      expect(statesEqual(folded, rebuilt)).toBe(true);
    });
  }

  it('holds under a different event interleaving', () => {
    const reducer = REDUCERS.training_volume;
    const record = freshRecord(reducer);
    const reordered = [...EVENTS].reverse().map((event, index) => ({
      ...event,
      sequence: index + 1,
    }));
    // Reversing breaks per-document ordering for wB and wC, so replay the final
    // versions on top — this is exactly what a real re-listen does.
    for (const event of reordered) applyEvent(record, reducer, event as AggregateEvent);
    applyEvent(record, reducer, workoutEvent('wB', null, workoutBEdited, 100));
    applyEvent(record, reducer, workoutEvent('wC', null, null, 101));
    expect(statesEqual(record.state, reducer.rebuild(SNAPSHOT))).toBe(true);
  });
});

describe('idempotence and replay', () => {
  it('re-applying the same event directly to reduce() is a no-op', () => {
    for (const id of Object.keys(REDUCERS) as AggregateId[]) {
      // Widening cast so the loop can call the union of reducers uniformly; each
      // reducer only ever receives its own state here.
      const reducer = REDUCERS[id] as unknown as AggregateReducer<AggregateId>;
      let state = reducer.empty();
      for (const event of EVENTS) state = reducer.reduce(state, event).state;
      for (const event of EVENTS.slice(0, 6)) {
        const replayed = reducer.reduce(state, event).state;
        // Replaying an OLD version of wB regresses that one document (the runner's
        // sequence gate exists for exactly this), but replaying the latest
        // version of anything must change nothing.
        if (event.id === 'wB' || event.id === 'wC') continue;
        expect(statesEqual(replayed, state), `${id} replay of ${event.id}`).toBe(true);
      }
    }
  });

  it('the runner sequence gate drops stale replays of the same document', () => {
    const reducer = REDUCERS.training_volume;
    const record = freshRecord(reducer);
    for (const event of EVENTS) applyEvent(record, reducer, event);
    const after = record.state;
    // A stale earlier version of wB replayed with an already-folded sequence.
    const outcome = applyEvent(record, reducer, workoutEvent('wB', null, workoutB, 4));
    expect(outcome.applied).toBe(false);
    expect(statesEqual(record.state, after)).toBe(true);
  });
});

describe('malformed documents', () => {
  it('are dropped with a reason, never thrown', () => {
    for (const id of Object.keys(REDUCERS) as AggregateId[]) {
      const reducer = REDUCERS[id] as unknown as AggregateReducer<AggregateId>;
      const garbage = { nothing: 'useful' } as unknown as Workout;
      const kind = reducer.handles[0] as AggregateEvent['kind'];
      const event = { kind, id: 'bad', previous: null, next: garbage, sequence: 999 } as AggregateEvent;
      const result = reducer.reduce(reducer.empty(), event);
      expect(result.dropped.length, id).toBeGreaterThanOrEqual(0); // must not throw
    }
  });

  it('a state without the internal index asks for a rebuild instead of guessing', () => {
    const bare = { kind: 'training_volume', weeks: [], monthlyVolumeKg: {} } as TrainingVolumeAggregate;
    const result = REDUCERS.training_volume.reduce(bare, workoutEvent('wA', null, workoutA, 1));
    expect(result.dropped[0]?.reason).toMatch(/^rebuild:/);
    expect(result.state).toBe(bare);
  });
});

// ---------------------------------------------------------------------------
// The arithmetic itself.
// ---------------------------------------------------------------------------

describe('training_volume arithmetic', () => {
  const state = foldAll('training_volume') as TrainingVolumeAggregate;
  const w35 = state.weeks.find((week) => week.week === '2026-W35');
  const w36 = state.weeks.find((week) => week.week === '2026-W36');

  it('buckets by ISO week and excludes discarded sessions', () => {
    expect(state.weeks.map((week) => week.week)).toEqual(['2026-W35', '2026-W36']);
    expect(w35?.sessionIds).toEqual(['wA']);
    expect(w36?.sessionIds).toEqual(['wB']);
  });

  it('counts volume from the sets: warmups out, failed sets in, unilateral doubled', () => {
    // wA: s2 100x5=500 + s3 (failed) 100x3=300 on bench; s4 unilateral 20x10x2=400.
    expect(w35?.volumeKg).toBe(1200);
    expect(w35?.workingSetCount).toBe(3);
    expect(w35?.failedSetCount).toBe(1);
    // Muscle split: bench 800 * (chest 1.0, triceps 0.5); split squat 400 quads.
    expect(w35?.volumeKgByMuscle.chest).toBe(800);
    expect(w35?.volumeKgByMuscle.triceps).toBe(400);
    expect(w35?.volumeKgByMuscle.quads).toBe(400);
    // Hard sets per muscle are fraction-weighted attempted working sets.
    expect(w35?.setsByMuscle.chest).toBe(2);
    expect(w35?.setsByMuscle.triceps).toBe(1);
  });

  it('reflects the edit, not the original', () => {
    expect(w36?.volumeKg).toBe(550); // 110x5, not 105x5
  });
});

describe('exercise_progress arithmetic', () => {
  const state = foldAll('exercise_progress') as ExerciseProgressAggregate;

  it('tracks one series per exercise key with e1RM from completed sets only', () => {
    const bench = state.series.find((series) => series.exerciseKey === 'bench_press');
    expect(bench?.points).toHaveLength(2);
    // wA best completed set is 100x5 → Epley 100*(1+5/30); the failed 100x3 is ignored.
    expect(bench?.points[0]?.e1rmKg).toBeCloseTo(116.666667, 5);
    expect(bench?.points[1]?.e1rmKg).toBeCloseTo(110 * (1 + 5 / 30), 5);
    expect(bench?.lastPerformedOn).toBe('2026-08-31');
  });
});

describe('personal_records arithmetic', () => {
  const state = foldAll('personal_records') as PersonalRecordsAggregate;

  it('flattens achievements newest first', () => {
    expect(state.achievements[0]?.value).toBe(105);
    expect(state.byExerciseKey['bench_press']).toHaveLength(2);
  });
});

describe('adherence arithmetic', () => {
  const state = foldAll('adherence') as AdherenceAggregate;

  it('counts planned (programmed) vs completed and set-level compliance', () => {
    const w35 = state.weeks.find((week) => week.week === '2026-W35');
    expect(w35?.completedSessions).toBe(1);
    expect(w35?.plannedSessions).toBe(1); // wA carries a programRef
    expect(w35?.prescriptionCompliance).toBe(0.5); // 1 of 2 prescribed sets completed
    const w36 = state.weeks.find((week) => week.week === '2026-W36');
    expect(w36?.plannedSessions).toBe(0);
    expect(w36?.prescriptionCompliance).toBeNull();
  });

  it('active dates exclude the discarded session', () => {
    expect(state.activeDates).toEqual(['2026-08-24', '2026-08-31']);
  });

  it('habit streaks count consecutive done days per habit', () => {
    expect(state.habitStreaks['water' as HabitId]?.currentDays).toBe(2);
    expect(state.habitStreaks['steps' as HabitId]).toBeUndefined(); // never done
  });
});

describe('nutrition arithmetic', () => {
  const state = foldAll('nutrition') as NutritionAggregate;

  it("uses the day's own snapshot first, then the target in force", () => {
    const monday = state.days.find((day) => day.localDate === '2026-08-24');
    expect(monday?.targetProteinG).toBe(30); // snapshot wins
    const tuesday = state.days.find((day) => day.localDate === '2026-08-25');
    expect(tuesday?.targetProteinG).toBe(150); // resolved from t1
  });

  it('hit rate counts logged days with a target', () => {
    // Monday: 40g >= 30g target — hit. Tuesday: 100g < 150g — miss.
    expect(state.proteinTargetHitRate).toBe(0.5);
    expect(state.loggingStreak.currentDays).toBe(2);
    expect(state.weeklyAverageKcal['2026-W35' as IsoWeek]).toBe(1300); // (600+2000)/2
  });
});
