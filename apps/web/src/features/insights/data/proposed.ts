import type { BodyFatMethod, IsoWeek, LocalDate } from '@freeforever/data';

/**
 * PROPOSED CONTRACT — NOT YET IN `packages/data/src/aggregates.ts`.
 *
 * `AGGREGATE_IDS` currently lists five reducers: training_volume, exercise_progress,
 * personal_records, adherence, nutrition. There is no body-metrics reducer, so there
 * is no sanctioned source for a bodyweight trend or a measurement chart — even though
 * `AggregateEvent` already carries `bodyMetric` and `DomainSnapshot` already carries
 * `bodyMetrics`, so the sync layer is reading the documents it would need.
 *
 * The rule says do not work around a missing aggregate, and this is not one: nothing
 * here reads Firestore, reads a raw document, or computes over user data. It is the
 * *shape* the body screens are written against, kept in the feature so the screens
 * compile, render their empty state today, and light up unchanged the day the reducer
 * lands. When it does, this file is deleted and the import moves to `@freeforever/data`.
 *
 * Owner: domain-model (the shape) and sync (the reducer). Reported to the integrator.
 *
 * Retention and boundedness follow the sibling aggregates: daily detail inside the
 * retention window, monthly rollups beyond it, so it cannot grow without limit.
 */

/** One local day of body measurement. Keyed by local date, like the source document. */
export interface BodyMetricPoint {
  readonly localDate: LocalDate;
  readonly weightKg?: number;
  readonly bodyFatPercent?: number;
  readonly bodyFatMethod?: BodyFatMethod;
  readonly restingHeartRateBpm?: number;
  readonly sleepQuality?: number;
  /** Only the sites actually measured that day. Keys are `BodyMeasurements` keys. */
  readonly measurementsCm?: Readonly<Record<string, number>>;
}

export interface BodyMetricsAggregate {
  readonly kind: 'body_metrics';
  /** Oldest first, one entry per day that has any measurement. */
  readonly days: readonly BodyMetricPoint[];
  /** Mean weight per ISO week — the honest unit for a bodyweight trend. */
  readonly weeklyMeanWeightKg: Readonly<Record<IsoWeek, number>>;
  /** Rolled-up months past retention, keyed `YYYY-MM`. */
  readonly monthlyMeanWeightKg: Readonly<Record<string, number>>;
  /** Which measurement sites the user has ever logged, so the picker has no dead options. */
  readonly measuredSites: readonly string[];
}

/** Human labels for the `BodyMeasurements` keys, minus the `Cm` suffix. */
export const MEASUREMENT_LABELS: Readonly<Record<string, string>> = {
  neckCm: 'Neck',
  shouldersCm: 'Shoulders',
  chestCm: 'Chest',
  waistCm: 'Waist',
  hipsCm: 'Hips',
  leftArmCm: 'Left arm',
  rightArmCm: 'Right arm',
  leftThighCm: 'Left thigh',
  rightThighCm: 'Right thigh',
  leftCalfCm: 'Left calf',
  rightCalfCm: 'Right calf',
};
