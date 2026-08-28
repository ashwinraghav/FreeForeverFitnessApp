import { describe, expect, it } from 'vitest';
import type { IsoWeek, LocalDate, MuscleGroup, TrainingVolumeAggregate, WorkoutId } from '@freeforever/data';
import { foldTail, heatLevelFor, muscleDistribution, muscleHeatmap } from '../select/muscles';
import { peakIndex, volumeSeries, volumeSummary } from '../select/volume';
import { adherenceSummary, calendarGrid } from '../select/adherence';
import { change, smooth, weightSeries } from '../select/body';
import { markRecordsByRunningMax, progressChartSeries, progressSummary } from '../select/e1rm';
import { prCounts, prTimeline } from '../select/prs';
import {
  adherenceFixture,
  bodyMetricsFixture,
  exerciseProgressFixture,
  personalRecordsFixture,
  trainingVolumeFixture,
} from '../data/fixtures';

const TODAY = '2026-08-28' as LocalDate; // a Friday, ISO 2026-W35
const END_WEEK = '2026-W35' as IsoWeek;

const bucket = (
  week: string,
  overrides: Partial<TrainingVolumeAggregate['weeks'][number]> = {},
): TrainingVolumeAggregate['weeks'][number] => ({
  week: week as IsoWeek,
  sessionCount: 3,
  workingSetCount: 45,
  failedSetCount: 0,
  volumeKg: 10_000,
  durationSec: 10_800,
  volumeKgByMuscle: {},
  setsByMuscle: {},
  sessionIds: [] as readonly WorkoutId[],
  ...overrides,
});

describe('volume', () => {
  it('keeps untrained weeks on the axis as zeros', () => {
    const aggregate: TrainingVolumeAggregate = {
      kind: 'training_volume',
      weeks: [bucket('2026-W33'), bucket('2026-W35')],
      monthlyVolumeKg: {},
    };
    const series = volumeSeries(aggregate, END_WEEK, 4);
    expect(series.map((point) => point.week)).toEqual([
      '2026-W32',
      '2026-W33',
      '2026-W34',
      '2026-W35',
    ]);
    expect(series.map((point) => point.volumeKg)).toEqual([0, 10_000, 0, 10_000]);
    expect(series.map((point) => point.empty)).toEqual([true, false, true, false]);
  });

  it('reports nothing rather than an infinite delta when the prior window is empty', () => {
    const aggregate: TrainingVolumeAggregate = {
      kind: 'training_volume',
      weeks: [bucket('2026-W35')],
      monthlyVolumeKg: {},
    };
    const summary = volumeSummary(aggregate, END_WEEK, 4);
    expect(summary.previousMeanWeeklyVolumeKg).toBeNull();
    expect(summary.meanWeeklyVolumeKg).toBe(2500);
    expect(summary.weeksTrained).toBe(1);
  });

  it('compares against the equally long window immediately before', () => {
    const aggregate: TrainingVolumeAggregate = {
      kind: 'training_volume',
      weeks: [
        bucket('2026-W31', { volumeKg: 4000 }),
        bucket('2026-W32', { volumeKg: 4000 }),
        bucket('2026-W34', { volumeKg: 12_000 }),
        bucket('2026-W35', { volumeKg: 12_000 }),
      ],
      monthlyVolumeKg: {},
    };
    const summary = volumeSummary(aggregate, END_WEEK, 2);
    expect(summary.meanWeeklyVolumeKg).toBe(12_000);
    expect(summary.previousMeanWeeklyVolumeKg).toBe(2000);
  });

  it('finds the peak for the single direct label, and nothing when flat at zero', () => {
    expect(peakIndex(volumeSeries(null, END_WEEK, 4))).toBeNull();
    const aggregate: TrainingVolumeAggregate = {
      kind: 'training_volume',
      weeks: [bucket('2026-W34', { volumeKg: 20_000 })],
      monthlyVolumeKg: {},
    };
    expect(peakIndex(volumeSeries(aggregate, END_WEEK, 4))).toBe(2);
  });

  it('is empty, not broken, with no aggregate at all', () => {
    expect(volumeSeries(null, END_WEEK, 3)).toHaveLength(3);
    expect(volumeSummary(null, END_WEEK, 3).totalVolumeKg).toBe(0);
  });
});

describe('muscle distribution', () => {
  const withMuscles = (week: string, sets: Partial<Record<MuscleGroup, number>>) =>
    bucket(week, { setsByMuscle: sets, volumeKgByMuscle: {} });

  it('sums across the window and sorts by sets descending', () => {
    const aggregate: TrainingVolumeAggregate = {
      kind: 'training_volume',
      weeks: [
        withMuscles('2026-W34', { chest: 6, lats: 9 }),
        withMuscles('2026-W35', { chest: 6, lats: 3, calves: 2 }),
      ],
      monthlyVolumeKg: {},
    };
    const distribution = muscleDistribution(aggregate, END_WEEK, 4);
    expect(distribution.totals.map((entry) => [entry.muscle, entry.sets])).toEqual([
      ['chest', 12],
      ['lats', 12],
      ['calves', 2],
    ]);
    expect(distribution.totalSets).toBe(26);
    // Ties break on label so the order is identical on every device.
    expect(distribution.totals[0]?.label).toBe('Chest');
  });

  it('ignores buckets outside the window', () => {
    const aggregate: TrainingVolumeAggregate = {
      kind: 'training_volume',
      weeks: [withMuscles('2026-W20', { chest: 100 }), withMuscles('2026-W35', { chest: 5 })],
      monthlyVolumeKg: {},
    };
    expect(muscleDistribution(aggregate, END_WEEK, 4).totalSets).toBe(5);
  });

  it('folds the tail rather than drawing twenty-one bars', () => {
    const totals = Array.from({ length: 12 }, (_, index) => ({
      muscle: 'chest' as MuscleGroup,
      label: `m${index}`,
      sets: 12 - index,
      volumeKg: 100,
      share: 0,
    }));
    const folded = foldTail(totals, 8);
    expect(folded.head).toHaveLength(8);
    expect(folded.tailCount).toBe(4);
    expect(folded.tailSets).toBe(4 + 3 + 2 + 1);
  });
});

describe('muscle heatmap', () => {
  it('levels relative to the busiest muscle of the week', () => {
    expect(heatLevelFor(0, 20)).toBe(0);
    expect(heatLevelFor(1, 20)).toBe(1);
    expect(heatLevelFor(5, 20)).toBe(1);
    expect(heatLevelFor(6, 20)).toBe(2);
    expect(heatLevelFor(15, 20)).toBe(3);
    expect(heatLevelFor(20, 20)).toBe(4);
  });

  it('never divides by zero on a week with nothing logged', () => {
    expect(heatLevelFor(0, 0)).toBe(0);
    expect(heatLevelFor(5, 0)).toBe(0);
  });

  it('carries each muscle its own baseline from the preceding weeks only', () => {
    const aggregate: TrainingVolumeAggregate = {
      kind: 'training_volume',
      weeks: [
        bucket('2026-W33', { setsByMuscle: { chest: 8 } }),
        bucket('2026-W34', { setsByMuscle: { chest: 12 } }),
        bucket('2026-W35', { setsByMuscle: { chest: 4, lats: 2 } }),
      ],
      monthlyVolumeKg: {},
    };
    const heatmap = muscleHeatmap(aggregate, END_WEEK, 2);
    expect(heatmap.byMuscle.get('chest')?.sets).toBe(4);
    expect(heatmap.byMuscle.get('chest')?.baselineSets).toBe(10);
    expect(heatmap.byMuscle.get('chest')?.level).toBe(4);
    // A muscle with history but no work this week is present and cold, not absent.
    expect(heatmap.byMuscle.get('lats')?.sets).toBe(2);
  });
});

describe('adherence', () => {
  it('has no state that means "missed"', () => {
    const grid = calendarGrid(adherenceFixture(TODAY, 8), TODAY, 4);
    const states = new Set(grid.flatMap((week) => week.days.map((day) => day.state)));
    for (const state of states) {
      expect(['trained', 'untrained', 'future', 'before-history']).toContain(state);
    }
  });

  it('builds Monday-aligned weeks of exactly seven days ending in today\'s week', () => {
    const grid = calendarGrid(adherenceFixture(TODAY, 8), TODAY, 4);
    expect(grid).toHaveLength(4);
    for (const week of grid) {
      expect(week.days).toHaveLength(7);
      expect(week.days.map((day) => day.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }
    expect(grid[grid.length - 1]?.days.some((day) => day.date === TODAY)).toBe(true);
  });

  it('marks days after today as future, never as untrained', () => {
    const grid = calendarGrid(adherenceFixture(TODAY, 8), TODAY, 2);
    const last = grid[grid.length - 1];
    // 2026-08-28 is a Friday, so Saturday and Sunday are still ahead.
    expect(last?.days[5]?.state).toBe('future');
    expect(last?.days[6]?.state).toBe('future');
  });

  it('reports a zero streak flatly, with no aggregate at all', () => {
    const summary = adherenceSummary(null, TODAY, 12);
    expect(summary.currentStreakDays).toBe(0);
    expect(summary.longestStreakDays).toBe(0);
    expect(summary.meanCompliance).toBeNull();
  });
});

describe('estimated 1RM progression', () => {
  const progress = exerciseProgressFixture(TODAY);
  const records = personalRecordsFixture(progress);

  it('marks a record by running maximum when the PR aggregate is missing', () => {
    expect(markRecordsByRunningMax([{ e1rmKg: 100 }, { e1rmKg: 99 }, { e1rmKg: 101 }] as never)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it('prefers the authoritative PR aggregate over the fallback', () => {
    const series = progress.series[0];
    expect(series).toBeDefined();
    const points = progressChartSeries(series ?? null, records);
    const marked = points.filter((point) => point.isRecord).map((point) => point.localDate);
    const authoritative = (records.byExerciseKey[series?.exerciseKey ?? ''] ?? []).map(
      (achievement) => achievement.achievedOn,
    );
    expect(marked).toEqual(authoritative);
  });

  it('decides records over the whole history, then windows', () => {
    const series = progress.series[0];
    const all = progressChartSeries(series ?? null, records);
    const from = all[all.length - 4]?.localDate;
    expect(from).toBeDefined();
    const windowed = progressChartSeries(series ?? null, records, {
      ...(from === undefined ? {} : { fromDate: from }),
    });
    const tail = all.slice(-4);
    // Zooming in must not promote a lesser session into a record it never was.
    expect(windowed.map((point) => point.isRecord)).toEqual(tail.map((point) => point.isRecord));
  });

  it('summarises first, last and best', () => {
    const points = progressChartSeries(progress.series[0] ?? null, records);
    const summary = progressSummary(points);
    expect(summary).not.toBeNull();
    expect(summary?.sessions).toBe(points.length);
    expect(summary?.best.e1rmKg).toBe(Math.max(...points.map((point) => point.e1rmKg)));
    expect(progressSummary([])).toBeNull();
  });
});

describe('personal records', () => {
  const progress = exerciseProgressFixture(TODAY);
  const records = personalRecordsFixture(progress);

  it('labels every record with the exercise it belongs to', () => {
    const timeline = prTimeline(records, progress);
    expect(timeline.length).toBeGreaterThan(0);
    for (const entry of timeline) {
      expect(entry.exerciseName).not.toBe(entry.exerciseKey);
      expect(entry.exerciseName.length).toBeGreaterThan(0);
    }
  });

  it('falls back to the key when no display name exists, rather than showing a blank', () => {
    const timeline = prTimeline(records, null);
    expect(timeline[0]?.exerciseName).toMatch(/[a-z-]+/);
  });

  it('is newest first and honours a limit', () => {
    const timeline = prTimeline(records, progress, { limit: 5 });
    expect(timeline).toHaveLength(5);
    const dates = timeline.map((entry) => entry.achievedAt);
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it('calls a first record first, not an infinite improvement', () => {
    const timeline = prTimeline(records, progress);
    const first = timeline[timeline.length - 1];
    expect(first?.isFirst).toBe(true);
    expect(first?.previousValue).toBeNull();
  });

  it('counts without comparing to a target', () => {
    const counts = prCounts(prTimeline(records, progress), TODAY);
    expect(counts.total).toBeGreaterThan(0);
    expect(counts.last30Days).toBeLessThanOrEqual(counts.last90Days);
    expect(counts.exercises).toBe(progress.series.length);
  });
});

describe('body metrics', () => {
  it('is empty and quiet when the aggregate does not exist yet', () => {
    const series = weightSeries(null);
    expect(series.raw).toEqual([]);
    expect(series.smoothed).toEqual([]);
    expect(change(series)).toBeNull();
  });

  it('smooths toward the signal and damps the noise', () => {
    const raw = [
      { localDate: '2026-01-01' as LocalDate, dayIndex: 0, value: 80 },
      { localDate: '2026-01-02' as LocalDate, dayIndex: 1, value: 90 },
      { localDate: '2026-01-03' as LocalDate, dayIndex: 2, value: 80 },
    ];
    const smoothed = smooth(raw, 7);
    const rawSpread = Math.max(...raw.map((p) => p.value)) - Math.min(...raw.map((p) => p.value));
    const spread =
      Math.max(...smoothed.map((p) => p.value)) - Math.min(...smoothed.map((p) => p.value));
    expect(spread).toBeLessThan(rawSpread);
    expect(smoothed[0]?.value).toBe(80);
  });

  it('weights by elapsed days, so a gap does not let a stale reading dominate', () => {
    const near = smooth(
      [
        { localDate: '2026-01-01' as LocalDate, dayIndex: 0, value: 80 },
        { localDate: '2026-01-02' as LocalDate, dayIndex: 1, value: 90 },
      ],
      7,
    );
    const far = smooth(
      [
        { localDate: '2026-01-01' as LocalDate, dayIndex: 0, value: 80 },
        { localDate: '2026-03-01' as LocalDate, dayIndex: 59, value: 90 },
      ],
      7,
    );
    expect(far[1]?.value ?? 0).toBeGreaterThan(near[1]?.value ?? 0);
  });

  it('reads the change off the smoothed line, not off two arbitrary weigh-ins', () => {
    const series = weightSeries(bodyMetricsFixture(TODAY, 120));
    const delta = change(series);
    expect(delta).not.toBeNull();
    expect(delta?.first.value).toBe(series.smoothed[0]?.value);
    expect(delta?.days).toBeGreaterThan(0);
  });
});

describe('fixtures', () => {
  it('are deterministic across runs', () => {
    expect(trainingVolumeFixture(TODAY, 8)).toEqual(trainingVolumeFixture(TODAY, 8));
    expect(adherenceFixture(TODAY, 8)).toEqual(adherenceFixture(TODAY, 8));
  });
});
