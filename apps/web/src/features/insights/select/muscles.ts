import type { IsoWeek, MuscleGroup, TrainingVolumeAggregate } from '@freeforever/data';
import { MUSCLE_LABELS } from '../data/ports';
import { weekWindow } from './weeks';

/**
 * Where the work went.
 *
 * Both surfaces here read `WeeklyVolumeBucket.setsByMuscle` and `volumeKgByMuscle`,
 * which the aggregate already split using each exercise's contribution fractions.
 * That split is the reason a bench press does not count as a full set of triceps and
 * a full set of chest, and it is why nothing in this file tries to reconstruct it.
 *
 * Hard sets, not volume, is the default reading: sets per muscle per week is the
 * number training programmes are actually written in, and it does not let one heavy
 * compound swamp a whole chart the way tonnage does.
 */

export interface MuscleTotal {
  readonly muscle: MuscleGroup;
  readonly label: string;
  readonly sets: number;
  readonly volumeKg: number;
  /** Share of the window's total sets, 0-1. */
  readonly share: number;
}

export interface MuscleDistribution {
  readonly totals: readonly MuscleTotal[];
  readonly totalSets: number;
  readonly weeks: number;
}

/**
 * Totals per muscle over a window, sorted by sets descending.
 *
 * Sorted rather than in anatomical order because the question this answers is a
 * ranking — "what am I actually training" — and a ranking read against a fixed
 * arbitrary order is not read at all.
 */
export function muscleDistribution(
  aggregate: TrainingVolumeAggregate | null,
  endWeek: IsoWeek,
  weeks: number,
): MuscleDistribution {
  const axis = new Set(weekWindow(endWeek, weeks));
  const sets = new Map<MuscleGroup, number>();
  const volume = new Map<MuscleGroup, number>();

  for (const bucket of aggregate?.weeks ?? []) {
    if (!axis.has(bucket.week)) continue;
    for (const [muscle, count] of Object.entries(bucket.setsByMuscle)) {
      if (count === undefined) continue;
      sets.set(muscle as MuscleGroup, (sets.get(muscle as MuscleGroup) ?? 0) + count);
    }
    for (const [muscle, kg] of Object.entries(bucket.volumeKgByMuscle)) {
      if (kg === undefined) continue;
      volume.set(muscle as MuscleGroup, (volume.get(muscle as MuscleGroup) ?? 0) + kg);
    }
  }

  const totalSets = [...sets.values()].reduce((sum, value) => sum + value, 0);
  const totals = [...new Set([...sets.keys(), ...volume.keys()])]
    .map((muscle) => ({
      muscle,
      label: MUSCLE_LABELS[muscle],
      sets: sets.get(muscle) ?? 0,
      volumeKg: volume.get(muscle) ?? 0,
      share: totalSets === 0 ? 0 : (sets.get(muscle) ?? 0) / totalSets,
    }))
    // Ties break on label so the order is stable across renders and across devices.
    .sort((a, b) => b.sets - a.sets || b.volumeKg - a.volumeKg || a.label.localeCompare(b.label));

  return { totals, totalSets, weeks };
}

/**
 * Twenty-one muscle groups is well past the point where a reader can hold a ranking
 * in their head, so the tail folds into one row rather than becoming twenty-one more
 * bars nobody scans. The folded rows stay reachable in the table view.
 */
export interface FoldedDistribution {
  readonly head: readonly MuscleTotal[];
  readonly tailSets: number;
  readonly tailVolumeKg: number;
  readonly tailCount: number;
}

export function foldTail(totals: readonly MuscleTotal[], keep: number): FoldedDistribution {
  const head = totals.slice(0, Math.max(0, keep));
  const tail = totals.slice(Math.max(0, keep));
  return {
    head,
    tailSets: tail.reduce((sum, entry) => sum + entry.sets, 0),
    tailVolumeKg: tail.reduce((sum, entry) => sum + entry.volumeKg, 0),
    tailCount: tail.length,
  };
}

/** The five heat levels the body map paints. 0 is "nothing this week". */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export interface MuscleHeat {
  readonly muscle: MuscleGroup;
  readonly label: string;
  readonly sets: number;
  readonly level: HeatLevel;
  /** Mean weekly sets over the baseline window, excluding the week being shown. */
  readonly baselineSets: number | null;
}

export interface MuscleHeatmap {
  readonly week: IsoWeek;
  readonly byMuscle: ReadonlyMap<MuscleGroup, MuscleHeat>;
  readonly maxSets: number;
  readonly totalSets: number;
}

/**
 * Level thresholds, as a fraction of the week's busiest muscle.
 *
 * Self-normalising on purpose. An absolute scale needs a "correct" weekly set count
 * per muscle, which does not exist — it depends on the programme, the training age
 * and the lifter — and inventing one turns a glance into a judgement. Relative to
 * the user's own week, the map answers the only question being asked between sets:
 * where has the work gone, and where has it not.
 */
const LEVEL_THRESHOLDS = [0.25, 0.5, 0.75] as const;

export function heatLevelFor(sets: number, maxSets: number): HeatLevel {
  if (sets <= 0 || maxSets <= 0) return 0;
  const ratio = sets / maxSets;
  if (ratio <= LEVEL_THRESHOLDS[0]) return 1;
  if (ratio <= LEVEL_THRESHOLDS[1]) return 2;
  if (ratio <= LEVEL_THRESHOLDS[2]) return 3;
  return 4;
}

/**
 * The body-map reading for one ISO week, with each muscle's own recent baseline
 * alongside it for the detail row.
 *
 * NOTE: this is *stimulus this week*, not recovery. True recovery needs the day a
 * muscle was last trained, and the aggregate contract buckets by week — inside the
 * current week there is no way to tell yesterday from six days ago. Reported as a
 * contract gap; the shape below does not change when that field arrives.
 */
export function muscleHeatmap(
  aggregate: TrainingVolumeAggregate | null,
  week: IsoWeek,
  baselineWeeks = 8,
): MuscleHeatmap {
  const current = aggregate?.weeks.find((bucket) => bucket.week === week);
  const baselineAxis = new Set(weekWindow(week, baselineWeeks + 1));
  baselineAxis.delete(week);

  const baselineTotals = new Map<MuscleGroup, number>();
  for (const bucket of aggregate?.weeks ?? []) {
    if (!baselineAxis.has(bucket.week)) continue;
    for (const [muscle, count] of Object.entries(bucket.setsByMuscle)) {
      if (count === undefined) continue;
      baselineTotals.set(muscle as MuscleGroup, (baselineTotals.get(muscle as MuscleGroup) ?? 0) + count);
    }
  }

  const sets = new Map<MuscleGroup, number>();
  for (const [muscle, count] of Object.entries(current?.setsByMuscle ?? {})) {
    if (count === undefined) continue;
    sets.set(muscle as MuscleGroup, count);
  }

  const maxSets = [...sets.values()].reduce((max, value) => Math.max(max, value), 0);
  const totalSets = [...sets.values()].reduce((sum, value) => sum + value, 0);

  const byMuscle = new Map<MuscleGroup, MuscleHeat>();
  for (const muscle of new Set([...sets.keys(), ...baselineTotals.keys()])) {
    const count = sets.get(muscle) ?? 0;
    const baselineTotal = baselineTotals.get(muscle);
    byMuscle.set(muscle, {
      muscle,
      label: MUSCLE_LABELS[muscle],
      sets: count,
      level: heatLevelFor(count, maxSets),
      baselineSets: baselineTotal === undefined ? null : baselineTotal / baselineWeeks,
    });
  }

  return { week, byMuscle, maxSets, totalSets };
}
