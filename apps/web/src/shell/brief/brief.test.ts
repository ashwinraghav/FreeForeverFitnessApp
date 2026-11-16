import type {
  AdherenceAggregate,
  EpochMillis,
  IsoWeek,
  LocalDate,
  PersonalRecordsAggregate,
  SetId,
  SortKey,
  TrainingVolumeAggregate,
  WorkoutExerciseId,
  WorkoutId,
} from '@freeforever/data';
import { describe, expect, it } from 'vitest';

import { STARTER_CATALOGUE } from '../../features/workout/catalogue/starter.js';
import { toExerciseRef } from '../../features/workout/catalogue/types.js';
import type { CompletedSession } from '../../features/workout/model/history.js';
import type { DraftExercise, DraftSet } from '../../features/workout/model/types.js';
import type { NutritionDay } from '../../features/nutrition/data/types.js';
import { buildBrief, setNotation, type BriefInputs } from './brief.js';

const bench = toExerciseRef(STARTER_CATALOGUE.find((entry) => entry.id === 'bench-press')!);
const pullUp = toExerciseRef(STARTER_CATALOGUE.find((entry) => entry.id === 'pull-up')!);
const plank = toExerciseRef(STARTER_CATALOGUE.find((entry) => entry.id === 'plank')!);

const TODAY = '2026-09-03' as LocalDate;
const GENERATED = new Date('2026-09-03T09:15:30.000Z');
const DAY = 86_400_000;
const NOW = Date.parse('2026-09-02T18:30:00.000Z');

function set(index: number, over: Partial<DraftSet> = {}): DraftSet {
  const base: DraftSet = {
    id: `s${index}` as SetId,
    sortKey: String.fromCharCode(97 + index) as SortKey,
    type: 'working',
    state: 'completed',
    loadKind: 'external',
    effortKind: 'reps',
    weightKg: 80,
    reps: 5,
    durationSec: null,
    distanceM: null,
    performedAt: (NOW + index * 180_000) as EpochMillis,
    ...over,
  };
  if (base.state !== 'pending') return base;
  // `performedAt` is present if and only if the set was attempted.
  const { performedAt: _never, ...pending } = base;
  return pending;
}

function exercise(ref: typeof bench, sets: readonly DraftSet[]): DraftExercise {
  return {
    id: `x-${ref.exerciseId}` as WorkoutExerciseId,
    sortKey: 'a' as SortKey,
    exercise: ref,
    sets,
  };
}

function session(over: Partial<CompletedSession> = {}): CompletedSession {
  return {
    id: 'w1',
    localDate: '2026-09-02' as LocalDate,
    startedAt: NOW,
    endedAt: NOW + 65 * 60_000,
    bodyweightKg: 78.4,
    exercises: [exercise(bench, [set(0), set(1)])],
    ...over,
  };
}

function inputs(over: Partial<BriefInputs> = {}): BriefInputs {
  return {
    sessions: [session()],
    volume: null,
    records: null,
    adherence: null,
    nutritionDays: [],
    nutritionTargets: {},
    today: TODAY,
    timeZone: 'Asia/Kolkata',
    generatedAt: GENERATED,
    ...over,
  };
}

describe('the brief', () => {
  it('says what it is, where it came from and when', () => {
    const text = buildBrief(inputs());

    expect(text).toContain('# Training brief');
    expect(text).toContain('Asia/Kolkata');
    expect(text).toContain('1 session logged, 2026-09-02 to 2026-09-02.');
    expect(text).toContain('Today is 2026-09-03.');
    expect(text).toContain('Generated 2026-09-03T09:15Z');
  });

  it('explains its own notation before using it', () => {
    // A model gets one pass with no schema. The legend is the difference between
    // `80x5@8` being data and being noise.
    const text = buildBrief(inputs());
    const legend = text.indexOf('## How to read this');
    const sessions = text.indexOf('## Sessions');

    expect(legend).toBeGreaterThan(-1);
    expect(sessions).toBeGreaterThan(legend);
  });

  it('renders a session as a date, a duration and one line per exercise', () => {
    const text = buildBrief(inputs());

    expect(text).toContain('2026-09-02 (65 min, bw 78.4kg)');
    expect(text).toContain('  Bench Press: 80x5 80x5');
  });

  it('leaves out warm-ups and sets that were never attempted', () => {
    const text = buildBrief(
      inputs({
        sessions: [
          session({
            exercises: [
              exercise(bench, [
                set(0, { type: 'warmup', weightKg: 40 }),
                set(1, { weightKg: 100 }),
                set(2, { state: 'pending', weightKg: 105 }),
              ]),
            ],
          }),
        ],
      }),
    );

    // The positive case in the same test, so a passing assertion cannot mean
    // "the line was never generated at all".
    expect(text).toContain('  Bench Press: 100x5');
    expect(text).not.toContain('40x5');
    expect(text).not.toContain('105x5');
  });

  it('drops an exercise with nothing attempted rather than printing an empty line', () => {
    const text = buildBrief(
      inputs({
        sessions: [
          session({
            exercises: [
              exercise(bench, [set(0, { weightKg: 100 })]),
              exercise(pullUp, [set(1, { state: 'pending' })]),
            ],
          }),
        ],
      }),
    );

    expect(text).toContain('Bench Press');
    expect(text).not.toContain('Pull-Up');
  });

  it('omits every derived section on a cold device, and includes them when materialised', () => {
    // The case that matters: aggregates are null mid-rebuild, and a heading with
    // nothing under it reads as "you have trained nothing".
    const cold = buildBrief(inputs());
    expect(cold).not.toContain('## Bests');
    expect(cold).not.toContain('## Weekly volume');
    expect(cold).not.toContain('## Consistency');
    // ...but the sessions themselves are never withheld.
    expect(cold).toContain('## Sessions');

    const warm = buildBrief(inputs({ records: RECORDS, volume: VOLUME, adherence: ADHERENCE }));
    expect(warm).toContain('## Bests');
    expect(warm).toContain('## Weekly volume');
    expect(warm).toContain('## Consistency');
  });

  it('names bests from the log rather than from the catalogue', () => {
    const text = buildBrief(inputs({ records: RECORDS }));

    // `bench-press` is the aggregate's key; "Bench Press" is what the lifter's own
    // session says it was called. A brief that printed the key would be unreadable.
    expect(text).toContain('Bench Press: heaviest 105kg x 3 (2026-08-12)');
    expect(text).toContain('best est. 1RM 112.5kg (2026-08-12)');
  });

  it('reports weekly volume newest first, grouped, with the muscle split on recent weeks', () => {
    const text = buildBrief(inputs({ volume: VOLUME }));
    const lines = text.split('\n');
    const weeks = lines.filter((line) => /^2026-W\d\d /u.test(line));

    expect(weeks[0]).toContain('2026-W36');
    expect(weeks[1]).toContain('2026-W35');
    expect(weeks[0]).toContain('18,400kg');
    expect(weeks[0]).toContain('2 missed');
    // Newest four weeks carry the split; older ones stay one line each.
    expect(text).toContain('sets by muscle: chest 18, lats 12');
  });

  it('counts consistency in the window it names', () => {
    const text = buildBrief(inputs({ adherence: ADHERENCE }));

    // Four active dates supplied, one of them 40 days ago.
    expect(text).toContain('Trained on 3 of the last 28 days');
    expect(text).toContain('Current streak 2 days; longest ever 21 days');
  });

  it('lists food as day totals, and only for days with something logged', () => {
    const text = buildBrief(inputs({ nutritionDays: FOOD }));

    expect(text).toContain('2 days logged in the last 28');
    expect(text).toContain('2026-09-01  1,980 kcal  P 140g  C 200g  F 70g');
    // An untouched day, and a day outside the window.
    expect(text).not.toContain('2026-08-31');
    expect(text).not.toContain('2026-06-01');
  });

  it('judges each day against the target that was in force on it', () => {
    // The plan can cycle calories across the week, so this is per-day and not one
    // number. `2026-09-02` is the day with its own snapshot; `2026-09-01` takes the
    // plan's entry for that weekday.
    const text = buildBrief(
      inputs({
        nutritionDays: FOOD,
        nutritionTargets: {
          '2026-09-01': { energyKcal: 2200, proteinG: 155, carbsG: 220, fatG: 75 },
          '2026-09-02': { energyKcal: 2600, proteinG: 165, carbsG: 280, fatG: 85 },
        },
      }),
    );

    // A snapshot on the day wins, exactly as the Eat tab resolves it.
    expect(text).toContain('2026-09-02  2,412 kcal  P 168g  C 240g  F 82g  / 2,400 kcal P 160g');
    expect(text).toContain('2026-09-01  1,980 kcal  P 140g  C 200g  F 70g  / 2,200 kcal P 155g');
    expect(text).toContain('After the slash is the target in force that day');
  });

  it('says there is nothing to judge intake against when no target is set', () => {
    // The state every user starts in, and the one the first version rendered as a
    // bare column of calories with no reference point. Nothing in the app writes
    // `targetSnapshot`, so before the plan was passed in this was every user.
    const noTarget = FOOD.filter((day) => day.targetSnapshot === undefined);
    const text = buildBrief(inputs({ nutritionDays: noTarget, nutritionTargets: {} }));

    expect(text).toContain('No calorie or macro target has been set');
    expect(text).not.toContain(' / ');
  });

  it('is a short, honest note when the device is empty', () => {
    const text = buildBrief(inputs({ sessions: [] }));

    expect(text).toContain('Nothing has been logged on this device yet.');
    expect(text).not.toContain('## Sessions');
    expect(text).not.toContain('## How to read this');
    expect(text.length).toBeLessThan(400);
  });

  it('marks a session that was edited after it finished', () => {
    // Bests are derived from history, so an edit silently rewrites "heaviest ever".
    // ADR-0029 keeps the timestamp for exactly this reason; the brief passes it on.
    const text = buildBrief(inputs({ sessions: [session({ editedAt: NOW + DAY })] }));

    expect(text).toContain('[edited after the session]');
  });
});

describe('set notation', () => {
  it('writes weight, reps and effort on the scale the lifter entered', () => {
    expect(setNotation(set(0, { effortRating: { scale: 'rpe', value: 8.5 } }))).toBe('80x5@8.5');
    expect(setNotation(set(0, { effortRating: { scale: 'rir', value: 2 } }))).toBe('80x5@2rir');
    expect(setNotation(set(0))).toBe('80x5');
  });

  it('marks a missed set, because it is work that never sets a record', () => {
    expect(setNotation(set(0, { state: 'failed' }))).toBe('80x5!');
  });

  it('reads off the numbers that are present, not the declared load kind', () => {
    expect(setNotation(set(0, { weightKg: null, loadKind: 'bodyweight', reps: 12 }))).toBe('x12');
    expect(
      setNotation(set(0, { weightKg: null, reps: null, durationSec: 45, loadKind: 'bodyweight' })),
    ).toBe('45s');
    expect(setNotation(set(0, { weightKg: null, reps: null, distanceM: 400 }))).toBe('400m');
  });

  it('never renders an empty set', () => {
    // A logged-but-blank set is possible: tapped, then the numbers cleared.
    expect(setNotation(set(0, { weightKg: null, reps: null }))).toBe('logged');
  });

  it('drops a trailing zero from a weight', () => {
    expect(setNotation(set(0, { weightKg: 82.5 }))).toBe('82.5x5');
    expect(setNotation(set(0, { weightKg: 80.0 }))).toBe('80x5');
  });
});

/**
 * The measurement the whole feature rests on.
 *
 * If the brief ever stops being dramatically smaller than the export it has stopped
 * being worth having, so the ratio is asserted rather than believed.
 *
 * Measured against a **full** store rather than a single week, deliberately. The brief
 * carries about 1.4 KB of fixed prose — the legend and the suggested questions — which
 * dominates a one-week sample and makes the ratio there look worse than the mechanism
 * is: 14x at 32 sets, 20x+ at 90, and it keeps improving because the per-set cost is
 * 11 bytes against 634. `MAX_LOCAL_HISTORY` is 60 sessions, so this is also the
 * largest brief this app can ever produce, which is the number that has to fit in a
 * context window.
 */
describe('size against the JSON export', () => {
  const week = (offset: number) =>
    session({
      id: `w${offset}`,
      localDate: `2026-08-${String(1 + (offset % 28)).padStart(2, '0')}` as LocalDate,
      startedAt: NOW - offset * DAY,
      endedAt: NOW - offset * DAY + 65 * 60_000,
      exercises: [
        exercise(bench, [set(0), set(1), set(2), set(3)]),
        exercise(pullUp, [set(0), set(1), set(2)]),
        exercise(plank, [set(0, { weightKg: null, reps: null, durationSec: 60 })]),
      ],
    });

  const bytes = (text: string) => new TextEncoder().encode(text).length;

  it('is more than twenty times smaller than the export of a full store', () => {
    const sessions = Array.from({ length: 60 }, (_, index) => week(index));
    const exported = bytes(
      JSON.stringify({ data: { 'ff.workout.history.v1': { v: 1, sessions } } }, null, 2),
    );
    const brief = bytes(buildBrief(inputs({ sessions })));

    expect(brief).toBeLessThan(exported / 20);
  });

  it('fits in a prompt even when the device is completely full', () => {
    // 60 sessions is the hard ceiling the store enforces. A brief that could grow
    // past a context window would be a feature with an unbounded payload, which is
    // the same class of problem ADR-0001 rule 2 exists to prevent.
    const sessions = Array.from({ length: 60 }, (_, index) => week(index));
    const brief = buildBrief(
      inputs({ sessions, records: RECORDS, volume: VOLUME, adherence: ADHERENCE }),
    );

    expect(bytes(brief)).toBeLessThan(64 * 1024);
  });
});

// ---------------------------------------------------------------------------
// Aggregates, as the reducers would have produced them
// ---------------------------------------------------------------------------

const RECORDS: PersonalRecordsAggregate = {
  kind: 'personal_records',
  achievements: [],
  byExerciseKey: {
    'bench-press': [
      {
        type: 'heaviest_weight',
        value: 105,
        reps: 3,
        achievedOn: '2026-08-12' as LocalDate,
        achievedAt: Date.parse('2026-08-12T18:00:00Z') as EpochMillis,
        workoutId: 'w-old' as WorkoutId,
      },
      {
        type: 'best_e1rm',
        value: 112.5,
        achievedOn: '2026-08-12' as LocalDate,
        achievedAt: Date.parse('2026-08-12T18:00:00Z') as EpochMillis,
        workoutId: 'w-old' as WorkoutId,
      },
      // A type the brief deliberately does not print: nobody quotes set volume.
      {
        type: 'best_set_volume',
        value: 315,
        achievedOn: '2026-08-12' as LocalDate,
        achievedAt: Date.parse('2026-08-12T18:00:00Z') as EpochMillis,
        workoutId: 'w-old' as WorkoutId,
      },
    ],
  },
};

const VOLUME: TrainingVolumeAggregate = {
  kind: 'training_volume',
  monthlyVolumeKg: {},
  weeks: [
    {
      week: '2026-W35' as IsoWeek,
      sessionCount: 3,
      workingSetCount: 60,
      failedSetCount: 0,
      volumeKg: 15_250,
      durationSec: 10_800,
      volumeKgByMuscle: {},
      setsByMuscle: { chest: 15 },
      sessionIds: [],
    },
    {
      week: '2026-W36' as IsoWeek,
      sessionCount: 4,
      workingSetCount: 92,
      failedSetCount: 2,
      volumeKg: 18_400,
      durationSec: 14_400,
      volumeKgByMuscle: {},
      setsByMuscle: { chest: 18, lats: 12 },
      sessionIds: [],
    },
  ],
};

const ADHERENCE: AdherenceAggregate = {
  kind: 'adherence',
  trainingStreak: {
    currentDays: 2,
    longestDays: 21,
    lastQualifyingDate: '2026-09-02' as LocalDate,
    timeZone: 'Asia/Kolkata',
  },
  weeks: [],
  habitStreaks: {},
  activeDates: ['2026-09-02', '2026-09-01', '2026-08-30', '2026-07-25'] as LocalDate[],
};

const FOOD: readonly NutritionDay[] = [
  {
    localDate: '2026-09-02',
    tzOffsetMinutes: 330,
    meals: [],
    totals: { energyKcal: 2412, proteinG: 168, carbsG: 240, fatG: 82 },
    entryCount: 7,
    waterMl: 2000,
    targetSnapshot: { energyKcal: 2400, proteinG: 160, carbsG: 260, fatG: 80 },
  },
  {
    localDate: '2026-09-01',
    tzOffsetMinutes: 330,
    meals: [],
    totals: { energyKcal: 1980, proteinG: 140, carbsG: 200, fatG: 70 },
    entryCount: 5,
    waterMl: 1500,
  },
  // Opened the tab, logged nothing.
  {
    localDate: '2026-08-31',
    tzOffsetMinutes: 330,
    meals: [],
    totals: { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    entryCount: 0,
    waterMl: 0,
  },
  // Outside the window.
  {
    localDate: '2026-06-01',
    tzOffsetMinutes: 330,
    meals: [],
    totals: { energyKcal: 2100, proteinG: 150, carbsG: 210, fatG: 75 },
    entryCount: 4,
    waterMl: 1000,
  },
];
