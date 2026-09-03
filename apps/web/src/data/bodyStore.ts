import type { IsoWeek, LocalDate } from '@freeforever/data';

import type { BodyMetricPoint, BodyMetricsAggregate } from '../features/insights/data/proposed';

/**
 * Weigh-ins, on the device, because there was nowhere to log one.
 *
 * The Body tab has always drawn a bodyweight chart and a measurements chart, and
 * `bodyMetrics` was hardcoded `null` in the real context — "a reducer that does not
 * exist in the contract yet". Every populated version of that screen anyone had seen
 * came from `data/fixtures.ts`. So the view was finished, the aggregate was designed,
 * and no code anywhere could record a single number.
 *
 * ## Why a local store rather than the reducer the contract wants
 *
 * `BodyMetricsAggregate` is described as a *materialised* aggregate, folded by the sync
 * layer from documents Firestore holds. That machinery does not exist and the app has
 * never talked to Firestore. Waiting for it would mean waiting for Phase 2 to log a
 * weight.
 *
 * This produces the same aggregate shape from `localStorage`, so `BodyView` and
 * `select/body` need no changes at all — they cannot tell the difference, which is the
 * point of the aggregate being a contract rather than a query. When the reducer lands it
 * replaces the producer and the view still does not change.
 *
 * ## One weigh-in per day, and the last one wins
 *
 * Bodyweight moves by a kilo or more within a day on water alone, so several readings
 * from one morning are noise pretending to be signal. `days` is documented as "one entry
 * per day"; recording twice replaces rather than appends, which also makes correcting a
 * typo the same gesture as logging.
 *
 * Kilograms on disk, always. Display conversion belongs to the view (`formatMass`), and
 * a store that held whichever unit was selected at the time would silently reinterpret
 * every old row the day somebody switched to pounds.
 */

const KEY = 'ff.body.v1';

/** A stored weigh-in. Deliberately narrow: the aggregate has room for more, this does not. */
export interface WeighIn {
  readonly localDate: LocalDate;
  readonly weightKg: number;
}

interface Envelope {
  readonly v: 1;
  readonly weighIns: readonly WeighIn[];
}

function read(storage: Storage): WeighIn[] {
  try {
    const raw = storage.getItem(KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const list = (parsed as Envelope).weighIns;
    if (!Array.isArray(list)) return [];
    // Filter rather than trust: a hand-edited or partially-written value must not take
    // the whole chart down. A bad row is dropped, not repaired into a wrong number.
    return list.filter(
      (entry): entry is WeighIn =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as WeighIn).localDate === 'string' &&
        typeof (entry as WeighIn).weightKg === 'number' &&
        Number.isFinite((entry as WeighIn).weightKg) &&
        (entry as WeighIn).weightKg > 0,
    );
  } catch {
    return [];
  }
}

function write(storage: Storage, weighIns: readonly WeighIn[]): void {
  const envelope: Envelope = { v: 1, weighIns };
  storage.setItem(KEY, JSON.stringify(envelope));
}

const byDate = (left: WeighIn, right: WeighIn): number =>
  left.localDate < right.localDate ? -1 : left.localDate > right.localDate ? 1 : 0;

export interface BodyStore {
  list(): readonly WeighIn[];
  /** Record or replace the weigh-in for a day. Returns the stored list, oldest first. */
  record(localDate: LocalDate, weightKg: number): readonly WeighIn[];
  remove(localDate: LocalDate): readonly WeighIn[];
}

export function createBodyStore(storage: Storage = localStorage): BodyStore {
  return {
    list: () => [...read(storage)].sort(byDate),
    record(localDate, weightKg) {
      const kept = read(storage).filter((entry) => entry.localDate !== localDate);
      const next = [...kept, { localDate, weightKg }].sort(byDate);
      write(storage, next);
      return next;
    },
    remove(localDate) {
      const next = read(storage)
        .filter((entry) => entry.localDate !== localDate)
        .sort(byDate);
      write(storage, next);
      return next;
    },
  };
}

/** ISO week key, `2026-W36`, matching what the aggregate contract expects. */
export function isoWeekOf(localDate: LocalDate): IsoWeek {
  const [y, m, d] = localDate.split('-').map(Number);
  // UTC throughout: this is calendar arithmetic on an already-local date string, and
  // constructing a local Date here would shift the day for anyone east of Greenwich.
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const day = date.getUTCDay() || 7; // Monday 1 … Sunday 7
  date.setUTCDate(date.getUTCDate() + 4 - day); // the Thursday of this ISO week
  const year = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDay = firstThursday.getUTCDay() || 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstDay);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${year}-W${String(week).padStart(2, '0')}` as IsoWeek;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Build the aggregate `BodyView` reads, from what is on the device.
 *
 * Returns `null` for an empty store rather than an empty aggregate, because `null` is
 * already the contract's "not materialised" state and every view renders it as an empty
 * state. An aggregate with no days would be a chart of nothing.
 */
export function toBodyMetrics(weighIns: readonly WeighIn[]): BodyMetricsAggregate | null {
  if (weighIns.length === 0) return null;

  const ordered = [...weighIns].sort(byDate);
  const days: BodyMetricPoint[] = ordered.map((entry) => ({
    localDate: entry.localDate,
    weightKg: entry.weightKg,
  }));

  const weekly = new Map<IsoWeek, number[]>();
  const monthly = new Map<string, number[]>();
  for (const entry of ordered) {
    const week = isoWeekOf(entry.localDate);
    const month = entry.localDate.slice(0, 7);
    weekly.set(week, [...(weekly.get(week) ?? []), entry.weightKg]);
    monthly.set(month, [...(monthly.get(month) ?? []), entry.weightKg]);
  }

  return {
    kind: 'body_metrics',
    days,
    weeklyMeanWeightKg: Object.fromEntries([...weekly].map(([k, v]) => [k, mean(v)])),
    monthlyMeanWeightKg: Object.fromEntries([...monthly].map(([k, v]) => [k, mean(v)])),
    // Nothing here logs tape measurements yet, and an empty list is what stops the
    // measurement picker offering sites with no data behind them.
    measuredSites: [],
  };
}
