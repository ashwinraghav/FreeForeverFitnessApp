import type { LocalDate } from '@freeforever/data';
import type { BodyMetricsAggregate, BodyMetricPoint } from '../data/proposed';
import { parseLocalDate } from './weeks';

/**
 * Body metrics.
 *
 * A bodyweight chart is the one screen in this product most likely to be read on a
 * bad day, so the treatment is deliberately flat: the raw daily points, a smoothed
 * line through them, and no target line, no goal band, no colour that says a
 * direction is good. Weight going up is not red and weight going down is not green —
 * the app does not know which way the user is trying to go, and pretending it does is
 * how a log becomes a judgement.
 *
 * The smoothing is the substance. Day-to-day bodyweight moves several kilos on water
 * alone, so the raw series shows noise the reader will read as fat gain. An
 * exponentially-weighted mean is drawn as the emphasis line and the raw points sit
 * behind it in the de-emphasis ink, which is the honest way round.
 */

export interface BodyPoint {
  readonly localDate: LocalDate;
  readonly dayIndex: number;
  readonly value: number;
}

export interface SmoothedSeries {
  readonly raw: readonly BodyPoint[];
  readonly smoothed: readonly BodyPoint[];
}

const MS_PER_DAY = 86_400_000;

function toPoints(
  days: readonly BodyMetricPoint[],
  read: (day: BodyMetricPoint) => number | undefined,
  fromDate: LocalDate | null,
): readonly BodyPoint[] {
  const from = fromDate === null ? null : parseLocalDate(fromDate);
  const rows: { date: Date; localDate: LocalDate; value: number }[] = [];
  for (const day of days) {
    const value = read(day);
    if (value === undefined || !Number.isFinite(value)) continue;
    const date = parseLocalDate(day.localDate);
    if (date === null) continue;
    if (from !== null && date.getTime() < from.getTime()) continue;
    rows.push({ date, localDate: day.localDate, value });
  }
  rows.sort((a, b) => a.date.getTime() - b.date.getTime());
  const origin = rows[0]?.date;
  if (origin === undefined) return [];
  return rows.map((row) => ({
    localDate: row.localDate,
    dayIndex: Math.round((row.date.getTime() - origin.getTime()) / MS_PER_DAY),
    value: row.value,
  }));
}

/**
 * Time-aware exponential smoothing.
 *
 * The weight is `2^(-gap / halfLifeDays)`, so a two-week gap in logging does not let
 * a fortnight-old reading dominate the next one the way a fixed-window mean would.
 * Nobody weighs themselves every day, and a smoother that assumes they do produces a
 * line with a visible cliff at every holiday.
 */
export function smooth(points: readonly BodyPoint[], halfLifeDays = 7): readonly BodyPoint[] {
  if (points.length === 0 || halfLifeDays <= 0) return points;
  const out: BodyPoint[] = [];
  let value = points[0]?.value ?? 0;
  let previousDay = points[0]?.dayIndex ?? 0;
  for (const point of points) {
    const gap = Math.max(0, point.dayIndex - previousDay);
    const weight = 2 ** (-gap / halfLifeDays);
    value = value * weight + point.value * (1 - weight);
    previousDay = point.dayIndex;
    out.push({ localDate: point.localDate, dayIndex: point.dayIndex, value });
  }
  return out;
}

export function weightSeries(
  aggregate: BodyMetricsAggregate | null,
  options: { readonly fromDate?: LocalDate; readonly halfLifeDays?: number } = {},
): SmoothedSeries {
  const raw = toPoints(aggregate?.days ?? [], (day) => day.weightKg, options.fromDate ?? null);
  return { raw, smoothed: smooth(raw, options.halfLifeDays ?? 7) };
}

export function measurementSeries(
  aggregate: BodyMetricsAggregate | null,
  site: string,
  options: { readonly fromDate?: LocalDate } = {},
): SmoothedSeries {
  const raw = toPoints(
    aggregate?.days ?? [],
    (day) => day.measurementsCm?.[site],
    options.fromDate ?? null,
  );
  // Tape measurements are taken weekly at most and are far less noisy than scale
  // weight, so they get a longer half-life: smoothing them at 7 days flattens signal.
  return { raw, smoothed: smooth(raw, 21) };
}

export interface BodyChange {
  readonly first: BodyPoint;
  readonly last: BodyPoint;
  readonly change: number;
  readonly days: number;
}

/**
 * First-to-last change, read off the smoothed line rather than the raw points.
 *
 * Reading it off the raw ends means the number reported depends on which two days
 * the user happened to step on the scale, which is exactly the noise the smoothing
 * exists to remove.
 */
export function change(series: SmoothedSeries): BodyChange | null {
  const first = series.smoothed[0];
  const last = series.smoothed[series.smoothed.length - 1];
  if (first === undefined || last === undefined) return null;
  return {
    first,
    last,
    change: last.value - first.value,
    days: last.dayIndex - first.dayIndex,
  };
}

/** Sites the user has actually measured, in a stable order for the picker. */
export function availableSites(aggregate: BodyMetricsAggregate | null): readonly string[] {
  const sites = new Set<string>(aggregate?.measuredSites ?? []);
  for (const day of aggregate?.days ?? []) {
    for (const site of Object.keys(day.measurementsCm ?? {})) sites.add(site);
  }
  return [...sites].sort();
}
