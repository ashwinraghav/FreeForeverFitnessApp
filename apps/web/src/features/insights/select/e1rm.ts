import type {
  ExerciseProgressAggregate,
  ExerciseProgressPoint,
  ExerciseProgressSeries,
  LocalDate,
  PersonalRecordsAggregate,
} from '@freeforever/data';
import { parseLocalDate } from './weeks';

/**
 * Estimated 1RM progression, one exercise at a time.
 *
 * One exercise, deliberately. Six overlaid lines is the form that buries the single
 * thing the reader came for, and this design system has one accent colour — a
 * six-series categorical palette does not exist in it and inventing hues to fill the
 * gap would fail every colourblind check. Emphasis is both the honest form and the
 * only one the palette supports: the chosen lift in accent, everything else absent.
 */

export interface ProgressChartPoint {
  readonly localDate: LocalDate;
  readonly dayIndex: number;
  readonly e1rmKg: number;
  readonly topSetLoadKg: number;
  readonly topSetReps: number;
  readonly totalVolumeKg: number;
  /** This session set a new best estimated 1RM. Drawn as a diamond, never as a colour. */
  readonly isRecord: boolean;
}

const MS_PER_DAY = 86_400_000;

function dayIndexOf(date: LocalDate, origin: Date): number {
  const parsed = parseLocalDate(date);
  return parsed === null ? 0 : Math.round((parsed.getTime() - origin.getTime()) / MS_PER_DAY);
}

/**
 * Which sessions were records.
 *
 * The authoritative answer lives in `personal_records`; this is the deterministic
 * fallback for when that aggregate has not been materialised yet, and the two agree
 * because both mean "beat every previous completed working set". Running-max over
 * the series is the whole algorithm — no rounding tolerance, because a 0.5kg e1RM
 * improvement is a real one and the estimate is already the approximation.
 */
export function markRecordsByRunningMax(
  points: readonly ExerciseProgressPoint[],
): readonly boolean[] {
  let best = 0;
  return points.map((point) => {
    if (point.e1rmKg > best) {
      best = point.e1rmKg;
      return true;
    }
    return false;
  });
}

/** Dates on which this exercise set a `best_e1rm` record, from the PR aggregate. */
function recordDatesFor(
  records: PersonalRecordsAggregate | null,
  exerciseKey: string,
): ReadonlySet<LocalDate> {
  const dates = new Set<LocalDate>();
  for (const achievement of records?.byExerciseKey[exerciseKey] ?? []) {
    if (achievement.type === 'best_e1rm') dates.add(achievement.achievedOn);
  }
  return dates;
}

export function progressChartSeries(
  series: ExerciseProgressSeries | null,
  records: PersonalRecordsAggregate | null,
  options: { readonly fromDate?: LocalDate } = {},
): readonly ProgressChartPoint[] {
  if (series === null) return [];
  const from = options.fromDate === undefined ? null : parseLocalDate(options.fromDate);
  const ordered = [...series.points].sort((a, b) => a.localDate.localeCompare(b.localDate));

  // Records are decided over the WHOLE history and then windowed, not decided inside
  // the window: zooming to the last three months must not promote a lesser session
  // into a personal record it never was.
  const recordDates = recordDatesFor(records, series.exerciseKey);
  const fallback = markRecordsByRunningMax(ordered);

  const origin = parseLocalDate(ordered[0]?.localDate ?? ('1970-01-01' as LocalDate));
  const base = origin ?? new Date(0);

  return ordered
    .map((point, index) => ({
      localDate: point.localDate,
      dayIndex: dayIndexOf(point.localDate, base),
      e1rmKg: point.e1rmKg,
      topSetLoadKg: point.topSetLoadKg,
      topSetReps: point.topSetReps,
      totalVolumeKg: point.totalVolumeKg,
      isRecord:
        recordDates.size > 0 ? recordDates.has(point.localDate) : (fallback[index] ?? false),
    }))
    .filter((point) => {
      if (from === null) return true;
      const parsed = parseLocalDate(point.localDate);
      return parsed !== null && parsed.getTime() >= from.getTime();
    });
}

export interface ProgressSummary {
  readonly first: ProgressChartPoint;
  readonly last: ProgressChartPoint;
  readonly best: ProgressChartPoint;
  readonly changeKg: number;
  readonly sessions: number;
}

export function progressSummary(points: readonly ProgressChartPoint[]): ProgressSummary | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return null;
  const best = points.reduce((max, point) => (point.e1rmKg > max.e1rmKg ? point : max), first);
  return { first, last, best, changeKg: last.e1rmKg - first.e1rmKg, sessions: points.length };
}

/**
 * Exercises for the picker, most recently performed first.
 *
 * Recency, not volume: the lift a user wants to look at is almost always the one they
 * did on Tuesday, not the one with the longest history.
 */
export function orderedSeries(
  aggregate: ExerciseProgressAggregate | null,
): readonly ExerciseProgressSeries[] {
  return [...(aggregate?.series ?? [])].sort((a, b) => {
    const left = a.lastPerformedOn ?? '';
    const right = b.lastPerformedOn ?? '';
    if (left !== right) return right.localeCompare(left);
    return b.points.length - a.points.length || a.displayName.localeCompare(b.displayName);
  });
}

export function findSeries(
  aggregate: ExerciseProgressAggregate | null,
  exerciseKey: string | null,
): ExerciseProgressSeries | null {
  if (exerciseKey === null) return orderedSeries(aggregate)[0] ?? null;
  return aggregate?.series.find((series) => series.exerciseKey === exerciseKey) ?? null;
}
