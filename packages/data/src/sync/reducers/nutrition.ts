import type {
  AggregateEvent,
  AggregateReducer,
  AggregateReduceResult,
  DailyNutritionBucket,
  NutritionAggregate,
  StreakState,
} from '../../aggregates.js';
import { AGGREGATE_RETENTION_WEEKS, AGGREGATE_VERSIONS } from '../../aggregates.js';
import type { IsoWeek, LocalDate } from '../../common/time.js';
import { round } from '../contribution.js';
import { addDays, compareLocalDates, isoWeekOf, streaksOf } from '../week.js';
import { hasInternal, needsRebuild, sortedKeys, unchanged, without } from './internal.js';

/**
 * Calories and macros versus target, per day and per week.
 *
 * Internal collections: one slim record per nutrition day, and one per macro
 * target. A day's target is its own `targetSnapshot` when it has one — that is
 * the number the user was actually judged against at the time — falling back to
 * the target in force on that date (latest `effectiveFrom` not after the day).
 */

interface DayFold {
  readonly localDate: LocalDate;
  readonly energyKcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
  readonly entryCount: number;
  /** From the day's own targetSnapshot; null means "resolve from targets". */
  readonly snapshotEnergyKcal: number | null;
  readonly snapshotProteinG: number | null;
  readonly hasSnapshot: boolean;
}

interface TargetFold {
  readonly effectiveFrom: LocalDate;
  readonly energyKcal: number;
  readonly proteinG: number;
}

interface NutritionInternal extends NutritionAggregate {
  readonly _days: Readonly<Record<string, DayFold>>;
  readonly _targets: Readonly<Record<string, TargetFold>>;
}

const RETENTION_DAYS = AGGREGATE_RETENTION_WEEKS.nutrition * 7;

const NO_STREAK: StreakState = {
  currentDays: 0,
  longestDays: 0,
  lastQualifyingDate: null,
  timeZone: null,
};

function resolveTarget(
  targets: Readonly<Record<string, TargetFold>>,
  date: LocalDate,
): TargetFold | null {
  let best: TargetFold | null = null;
  for (const id of sortedKeys(targets)) {
    const target = targets[id] as TargetFold;
    if (compareLocalDates(target.effectiveFrom, date) > 0) continue;
    if (best === null || compareLocalDates(target.effectiveFrom, best.effectiveFrom) >= 0) {
      best = target;
    }
  }
  return best;
}

function derive(
  days: Readonly<Record<string, DayFold>>,
  targets: Readonly<Record<string, TargetFold>>,
): NutritionInternal {
  let maxDate: string | null = null;
  for (const id of Object.keys(days)) {
    const date = (days[id] as DayFold).localDate;
    if (maxDate === null || compareLocalDates(date, maxDate) > 0) maxDate = date;
  }
  const cutoff = maxDate === null ? null : addDays(maxDate, -RETENTION_DAYS);

  const kept: Record<string, DayFold> = {};
  for (const id of sortedKeys(days)) {
    const day = days[id] as DayFold;
    if (cutoff === null || compareLocalDates(day.localDate, cutoff) >= 0) kept[id] = day;
  }

  const buckets: DailyNutritionBucket[] = [];
  const weekTotals = new Map<IsoWeek, { kcal: number; count: number }>();
  const loggedDates: string[] = [];
  let daysWithProteinTarget = 0;
  let daysHitProteinTarget = 0;

  for (const id of sortedKeys(kept)) {
    const day = kept[id] as DayFold;
    const resolved = day.hasSnapshot ? null : resolveTarget(targets, day.localDate);
    const targetEnergyKcal = day.hasSnapshot ? day.snapshotEnergyKcal : (resolved?.energyKcal ?? null);
    const targetProteinG = day.hasSnapshot ? day.snapshotProteinG : (resolved?.proteinG ?? null);
    buckets.push({
      localDate: day.localDate,
      energyKcal: day.energyKcal,
      proteinG: day.proteinG,
      carbsG: day.carbsG,
      fatG: day.fatG,
      targetEnergyKcal,
      targetProteinG,
      entryCount: day.entryCount,
    });
    if (day.entryCount > 0) {
      loggedDates.push(day.localDate);
      const week = isoWeekOf(day.localDate);
      const total = weekTotals.get(week) ?? { kcal: 0, count: 0 };
      total.kcal += day.energyKcal;
      total.count += 1;
      weekTotals.set(week, total);
      if (targetProteinG !== null && targetProteinG > 0) {
        daysWithProteinTarget += 1;
        if (day.proteinG >= targetProteinG) daysHitProteinTarget += 1;
      }
    }
  }

  const weeklyAverageKcal: Record<IsoWeek, number> = {};
  for (const week of [...weekTotals.keys()].sort()) {
    const total = weekTotals.get(week) as { kcal: number; count: number };
    weeklyAverageKcal[week] = round(total.kcal / total.count);
  }

  const loggingStreak: StreakState =
    loggedDates.length === 0
      ? NO_STREAK
      : { ...streaksOf(loggedDates), timeZone: null };

  return {
    kind: 'nutrition',
    days: buckets,
    weeklyAverageKcal,
    proteinTargetHitRate:
      daysWithProteinTarget === 0 ? null : round(daysHitProteinTarget / daysWithProteinTarget),
    loggingStreak,
    _days: kept,
    _targets: targets,
  };
}

function reduce(
  state: NutritionAggregate,
  event: AggregateEvent,
): AggregateReduceResult<'nutrition'> {
  if (event.kind !== 'nutritionDay' && event.kind !== 'macroTarget') return unchanged(state);
  if (!hasInternal(state, '_days') || !hasInternal(state, '_targets')) {
    return needsRebuild(state, event.id, 'state has no per-source index');
  }
  const internal = state as NutritionInternal;
  try {
    if (event.kind === 'nutritionDay') {
      const days = without(internal._days, event.id);
      if (event.next === null) return { state: derive(days, internal._targets), dropped: [] };
      const day = event.next;
      const fold: DayFold = {
        localDate: day.localDate,
        energyKcal: round(day.totals.energyKcal),
        proteinG: round(day.totals.proteinG),
        carbsG: round(day.totals.carbsG),
        fatG: round(day.totals.fatG),
        entryCount: day.entryCount,
        snapshotEnergyKcal: day.targetSnapshot?.energyKcal ?? null,
        snapshotProteinG: day.targetSnapshot?.proteinG ?? null,
        hasSnapshot: day.targetSnapshot !== undefined,
      };
      return { state: derive({ ...days, [event.id]: fold }, internal._targets), dropped: [] };
    }
    const targets = without(internal._targets, event.id);
    if (event.next === null) return { state: derive(internal._days, targets), dropped: [] };
    const fold: TargetFold = {
      effectiveFrom: event.next.effectiveFrom,
      energyKcal: event.next.values.energyKcal,
      proteinG: event.next.values.proteinG,
    };
    return { state: derive(internal._days, { ...targets, [event.id]: fold }), dropped: [] };
  } catch (error) {
    return { state, dropped: [{ id: event.id, reason: String(error) }] };
  }
}

export const nutritionReducer: AggregateReducer<'nutrition'> = {
  id: 'nutrition',
  version: AGGREGATE_VERSIONS.nutrition,
  handles: ['nutritionDay', 'macroTarget'],
  empty: () => derive({}, {}),
  reduce,
  rebuild: (snapshot) => {
    const days: Record<string, DayFold> = {};
    for (const day of snapshot.nutritionDays) {
      days[day.id] = {
        localDate: day.localDate,
        energyKcal: round(day.totals.energyKcal),
        proteinG: round(day.totals.proteinG),
        carbsG: round(day.totals.carbsG),
        fatG: round(day.totals.fatG),
        entryCount: day.entryCount,
        snapshotEnergyKcal: day.targetSnapshot?.energyKcal ?? null,
        snapshotProteinG: day.targetSnapshot?.proteinG ?? null,
        hasSnapshot: day.targetSnapshot !== undefined,
      };
    }
    const targets: Record<string, TargetFold> = {};
    for (const target of snapshot.macroTargets) {
      targets[target.id] = {
        effectiveFrom: target.effectiveFrom,
        energyKcal: target.values.energyKcal,
        proteinG: target.values.proteinG,
      };
    }
    return derive(days, targets);
  },
};
