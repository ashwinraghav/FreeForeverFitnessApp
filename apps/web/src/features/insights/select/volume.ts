import type { IsoWeek, TrainingVolumeAggregate, WeeklyVolumeBucket } from '@freeforever/data';
import { weekWindow } from './weeks';

/**
 * Volume over time.
 *
 * Reads `TrainingVolumeAggregate.weeks` and nothing else. The aggregate is already
 * the fold, so this is an index and a window — O(window), not O(history) — which is
 * what keeps the screen cheap over the 104 weeks of detail the contract retains.
 */

export interface VolumePoint {
  readonly week: IsoWeek;
  readonly volumeKg: number;
  readonly workingSetCount: number;
  readonly failedSetCount: number;
  readonly sessionCount: number;
  readonly durationSec: number;
  /** True when the week has no bucket at all, as opposed to a bucket of zero. */
  readonly empty: boolean;
}

export const EMPTY_VOLUME_POINT = {
  volumeKg: 0,
  workingSetCount: 0,
  failedSetCount: 0,
  sessionCount: 0,
  durationSec: 0,
} as const;

function indexByWeek(
  buckets: readonly WeeklyVolumeBucket[],
): ReadonlyMap<IsoWeek, WeeklyVolumeBucket> {
  const index = new Map<IsoWeek, WeeklyVolumeBucket>();
  for (const bucket of buckets) index.set(bucket.week, bucket);
  return index;
}

/**
 * The dense series for the chart: exactly `weeks` points ending at `endWeek`, in
 * order, with untrained weeks present and zero. A missing week that vanishes from
 * the axis is the single most common way a training chart lies.
 */
export function volumeSeries(
  aggregate: TrainingVolumeAggregate | null,
  endWeek: IsoWeek,
  weeks: number,
): readonly VolumePoint[] {
  const axis = weekWindow(endWeek, weeks);
  const index = indexByWeek(aggregate?.weeks ?? []);
  return axis.map((week) => {
    const bucket = index.get(week);
    if (bucket === undefined) return { week, ...EMPTY_VOLUME_POINT, empty: true };
    return {
      week,
      volumeKg: bucket.volumeKg,
      workingSetCount: bucket.workingSetCount,
      failedSetCount: bucket.failedSetCount,
      sessionCount: bucket.sessionCount,
      durationSec: bucket.durationSec,
      empty: false,
    };
  });
}

export interface VolumeSummary {
  readonly totalVolumeKg: number;
  readonly meanWeeklyVolumeKg: number;
  readonly totalSessions: number;
  readonly totalWorkingSets: number;
  readonly totalDurationSec: number;
  /** Mean weekly volume over the equally long window immediately before this one. */
  readonly previousMeanWeeklyVolumeKg: number | null;
  readonly weeksTrained: number;
}

/**
 * The headline numbers. `previousMeanWeeklyVolumeKg` is null when the prior window
 * has no data at all — comparing this month against a month the user did not own the
 * app is not a comparison, and rendering it as "+∞" is worse than rendering nothing.
 */
export function volumeSummary(
  aggregate: TrainingVolumeAggregate | null,
  endWeek: IsoWeek,
  weeks: number,
): VolumeSummary {
  const current = volumeSeries(aggregate, endWeek, weeks);
  const total = current.reduce(
    (acc, point) => ({
      volumeKg: acc.volumeKg + point.volumeKg,
      sessions: acc.sessions + point.sessionCount,
      sets: acc.sets + point.workingSetCount,
      durationSec: acc.durationSec + point.durationSec,
      trained: acc.trained + (point.sessionCount > 0 ? 1 : 0),
    }),
    { volumeKg: 0, sessions: 0, sets: 0, durationSec: 0, trained: 0 },
  );

  const firstWeek = current[0]?.week;
  const priorEnd = firstWeek === undefined ? undefined : weekWindow(firstWeek, 2)[0];
  const prior =
    priorEnd === undefined ? [] : volumeSeries(aggregate, priorEnd, weeks).filter((p) => !p.empty);
  const priorMean =
    prior.length === 0 ? null : prior.reduce((sum, p) => sum + p.volumeKg, 0) / weeks;

  return {
    totalVolumeKg: total.volumeKg,
    meanWeeklyVolumeKg: weeks === 0 ? 0 : total.volumeKg / weeks,
    totalSessions: total.sessions,
    totalWorkingSets: total.sets,
    totalDurationSec: total.durationSec,
    previousMeanWeeklyVolumeKg: priorMean,
    weeksTrained: total.trained,
  };
}

/** Index of the largest point, for the one direct label the chart is allowed. */
export function peakIndex(points: readonly VolumePoint[]): number | null {
  let best = -1;
  let bestValue = 0;
  points.forEach((point, index) => {
    if (point.volumeKg > bestValue) {
      bestValue = point.volumeKg;
      best = index;
    }
  });
  return best === -1 ? null : best;
}
