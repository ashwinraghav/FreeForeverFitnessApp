import { describe, expect, it } from 'vitest';
import type { LocalDate, TrainingVolumeAggregate } from '@freeforever/data';
import { DEFAULT_UNIT_PREFERENCES } from '@freeforever/data';
import { WORKOUT_STORAGE_KEYS } from '../../features/workout/storage/workoutStore';
import { domainSnapshotOf, insightsSnapshotOf } from '../localAggregates';
import { WORKOUT_HISTORY_KEY, createLocalInsightsSource } from '../insightsSource';
import { SESSIONS, fakeStorage, historyBlob } from './fixtures';

/**
 * These assert numbers, not renders.
 *
 * The bug being fixed here was not a crash: the Progress tab mounted perfectly and
 * drew "No data yet" forever, and `insights/data/ports.ts` documents that empty
 * render as correct for a device mid-rebuild — so an "it renders" test was green
 * throughout and would have stayed green after any wiring mistake. The only test that
 * can fail on this class of bug is one that names the number it expects to see.
 *
 * Every expectation below is worked out by hand from `./fixtures.ts`:
 *
 *   session 1  bench   40x10 warmup, 100x5, 100x5            1000 kg, 2 working sets
 *   session 2  squat   140x5, 140x5                          1400 kg, 2 working sets
 *   session 3  bench   105x5, 105x3, 110x1 failed             950 kg, 3 working sets
 *                                                            ----
 *                                                            3350 kg over 7 sets
 */

const TODAY = '2026-08-13' as LocalDate;

function snapshot() {
  return insightsSnapshotOf({
    sessions: SESSIONS,
    timeZone: 'Europe/London',
    today: TODAY,
    units: DEFAULT_UNIT_PREFERENCES,
  });
}

function week(aggregate: TrainingVolumeAggregate | null) {
  const bucket = aggregate?.weeks[0];
  if (bucket === undefined) throw new Error('expected a week bucket');
  return bucket;
}

describe('training volume', () => {
  it('totals the sessions into the ISO week they happened in', () => {
    const bucket = week(snapshot().trainingVolume);
    expect(bucket.week).toBe('2026-W33');
    expect(bucket.sessionCount).toBe(3);
    expect(bucket.volumeKg).toBe(3350);
    expect(bucket.durationSec).toBe(3600 + 1800 + 2700);
  });

  it('counts attempted working sets, excludes the warmup, and reports the failure separately', () => {
    const bucket = week(snapshot().trainingVolume);
    // 2 + 2 + 3. The 40x10 warmup is not a working set; the failed 110x1 is.
    expect(bucket.workingSetCount).toBe(7);
    expect(bucket.failedSetCount).toBe(1);
  });

  it('splits volume by the muscle fractions on each exercise', () => {
    const bucket = week(snapshot().trainingVolume);
    // Bench is chest 1.0 / triceps 0.5 over 1950 kg; squat is quads 1.0 /
    // glutes 0.5 over 1400 kg.
    expect(bucket.volumeKgByMuscle).toEqual({
      chest: 1950,
      glutes: 700,
      quads: 1400,
      triceps: 975,
    });
    expect(bucket.setsByMuscle).toEqual({ chest: 5, glutes: 1, quads: 2, triceps: 2.5 });
  });
});

describe('adherence', () => {
  it('counts three consecutive days as a three-day streak', () => {
    const adherence = snapshot().adherence;
    expect(adherence?.trainingStreak.currentDays).toBe(3);
    expect(adherence?.trainingStreak.longestDays).toBe(3);
    expect(adherence?.trainingStreak.lastQualifyingDate).toBe('2026-08-12');
    expect(adherence?.activeDates).toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
  });

  it('reports no plan, because a finished session carries no link to one', () => {
    // Not an empty result: `DraftWorkout` has no `programRef` and `DraftSet` has no
    // `target`, so these two are structurally unknowable from local history. If the
    // workout feature ever records them, this test is the one that should change.
    const bucket = snapshot().adherence?.weeks[0];
    expect(bucket?.completedSessions).toBe(3);
    expect(bucket?.plannedSessions).toBe(0);
    expect(bucket?.prescriptionCompliance).toBeNull();
  });
});

describe('exercise progress', () => {
  it('gives each lift its own series of session bests', () => {
    const series = snapshot().exerciseProgress?.series ?? [];
    expect(series.map((entry) => entry.exerciseKey)).toEqual(['back-squat', 'bench-press']);

    const bench = series.find((entry) => entry.exerciseKey === 'bench-press');
    expect(bench?.displayName).toBe('Barbell bench press');
    expect(bench?.lastPerformedOn).toBe('2026-08-12');
    expect(bench?.points.map((point) => point.e1rmKg)).toEqual([116.666667, 122.5]);
    expect(bench?.points.map((point) => point.topSetLoadKg)).toEqual([100, 105]);
    // The 110 kg set was failed, so it is not the top set of the session.
    expect(bench?.points[1]?.topSetReps).toBe(5);
  });
});

describe('personal records', () => {
  it('reconstructs a record document per exercise key from the local history', () => {
    const records = snapshot().personalRecords;
    expect(Object.keys(records?.byExerciseKey ?? {})).toEqual(['back-squat', 'bench-press']);
    expect(records?.achievements.length).toBe(13);
  });

  it('dates the newest records to the session that set them, newest first', () => {
    const achievements = snapshot().personalRecords?.achievements ?? [];
    expect(achievements.slice(0, 3).map((entry) => [entry.type, entry.value])).toEqual([
      ['best_e1rm', 122.5],
      ['best_set_volume', 525],
      ['heaviest_weight', 105],
    ]);
    expect(achievements[2]?.achievedOn).toBe('2026-08-12');
    expect(achievements[2]?.previousValue).toBe(100);
  });

  it('never lets a failed set set a record, however heavy', () => {
    const bench = snapshot().personalRecords?.byExerciseKey['bench-press'] ?? [];
    const heaviest = bench.filter((entry) => entry.type === 'heaviest_weight');
    // 110 kg was attempted and missed on 2026-08-12. The best completed load is 105.
    expect(heaviest.map((entry) => entry.value)).toEqual([105, 100]);
    expect(bench.some((entry) => entry.value === 110)).toBe(false);
  });

  it('does not award a record for equalling one', () => {
    // Bench hit 5 reps in both sessions, so `most_reps` is set once and never beaten.
    const bench = snapshot().personalRecords?.byExerciseKey['bench-press'] ?? [];
    const mostReps = bench.filter((entry) => entry.type === 'most_reps');
    expect(mostReps.length).toBe(1);
    expect(mostReps[0]?.achievedOn).toBe('2026-08-10');
  });

  it('records the heaviest load completed at each tracked rep count', () => {
    const documents = domainSnapshotOf({ sessions: SESSIONS, timeZone: 'UTC' }).personalRecords;
    const bench = documents.find((document) => document.id === 'bench-press');
    expect(bench?.repMaxKgByReps).toEqual({ '3': 105, '5': 105 });
    expect(bench?.lastAchievedOn).toBe('2026-08-12');
  });
});

describe('reading the device', () => {
  it('agrees with the key the workout feature actually writes', () => {
    // The store restates this key rather than indexing the exported tuple. This is
    // what stops the copy drifting from the original in silence.
    expect(WORKOUT_STORAGE_KEYS).toContain(WORKOUT_HISTORY_KEY);
  });

  it('folds what is in localStorage, not what was passed in', () => {
    const storage = fakeStorage();
    storage.setItem(WORKOUT_HISTORY_KEY, historyBlob());
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

    const source = createLocalInsightsSource({
      now: () => new Date('2026-08-13T09:00:00Z'),
      timeZone: 'Europe/London',
    });
    const read = source.read();
    expect(read.today).toBe('2026-08-13');
    expect(read.timeZone).toBe('Europe/London');
    expect(read.trainingVolume?.weeks[0]?.volumeKg).toBe(3350);
    expect(read.adherence?.trainingStreak.currentDays).toBe(3);
    expect(read.rebuilding).toBe(false);
    // `useSyncExternalStore` requires a stable snapshot between changes.
    expect(source.read()).toBe(read);
  });

  it('is empty rather than broken when the device has never logged anything', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: fakeStorage(),
      configurable: true,
    });
    const read = createLocalInsightsSource().read();
    expect(read.trainingVolume?.weeks).toEqual([]);
    expect(read.personalRecords?.achievements).toEqual([]);
    expect(read.adherence?.trainingStreak.currentDays).toBe(0);
    // No reducer exists for body metrics, so this stays the port's null.
    expect(read.bodyMetrics).toBeNull();
  });
});
