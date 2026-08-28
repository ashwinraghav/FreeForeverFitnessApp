import { z } from 'zod';
import { documentEnvelopeSchema } from './common/envelope.js';
import type { ExerciseId, HabitId, WorkoutId } from './common/ids.js';
import type { IsoWeek, LocalDate } from './common/time.js';
import { localDateSchema, serverTimestampSchema } from './common/time.js';
import type { MuscleGroup } from './schemas/exercise.js';
import type { PrAchievement } from './schemas/records.js';

/**
 * Locally materialised aggregates — the contract between the sync layer, which
 * maintains them, and `features/insights`, which reads them.
 *
 * ADR-0005 makes this the only way an insights screen may get a number: a Firestore
 * query inside `features/insights` is a build failure. Everything a chart needs is
 * folded into these shapes on write and read back from the local cache.
 *
 * Three properties make that survivable, and they are the reason the reducer
 * signature looks the way it does:
 *
 * **Idempotence.** Sync replays. A reducer that adds a session's volume to a running
 * total double-counts the first time a listener re-fires. So every mutating event
 * carries both `previous` and `next`: the reducer subtracts the old contribution and
 * adds the new one, which makes applying the same event twice a no-op.
 *
 * **Rebuildability.** Aggregates are derived, never authoritative. Every reducer can
 * reconstruct its whole state from the underlying documents. Drift is therefore a
 * performance bug, not data loss, and `version` bumping forces the rebuild.
 *
 * **Boundedness.** Free-forever rule 2 applies to bytes as much as to requests. Each
 * aggregate declares its retention, and none of them grow without limit.
 *
 * Implementation of the reducers belongs to the sync team. This file is the shape.
 */

export const AGGREGATE_IDS = [
  'training_volume',
  'exercise_progress',
  'personal_records',
  'adherence',
  'nutrition',
] as const;

export const aggregateIdSchema = z.enum(AGGREGATE_IDS);
export type AggregateId = z.infer<typeof aggregateIdSchema>;

/**
 * Bumped when a reducer's output shape or arithmetic changes. A stored aggregate
 * whose `version` is below the reducer's is discarded and rebuilt rather than
 * migrated — these are derived data, so rebuilding is always correct and always
 * cheaper to reason about than a migration.
 */
export const AGGREGATE_VERSIONS: Record<AggregateId, number> = {
  training_volume: 1,
  exercise_progress: 1,
  personal_records: 1,
  adherence: 1,
  nutrition: 1,
};

/** How far back each aggregate keeps detail. Beyond this it keeps monthly rollups. */
export const AGGREGATE_RETENTION_WEEKS: Record<AggregateId, number> = {
  training_volume: 104,
  exercise_progress: 104,
  personal_records: 520,
  adherence: 104,
  nutrition: 104,
};

// ---------------------------------------------------------------------------
// Aggregate payloads
// ---------------------------------------------------------------------------

/** One ISO week of training. The unit every volume chart is drawn from. */
export interface WeeklyVolumeBucket {
  readonly week: IsoWeek;
  readonly sessionCount: number;
  readonly workingSetCount: number;
  readonly failedSetCount: number;
  readonly volumeKg: number;
  readonly durationSec: number;
  /** Volume split by muscle, using each exercise's contribution fractions. */
  readonly volumeKgByMuscle: Partial<Record<MuscleGroup, number>>;
  /** Hard sets per muscle — the number most programming actually tracks. */
  readonly setsByMuscle: Partial<Record<MuscleGroup, number>>;
  /** Session ids folded into this bucket, so a re-sync can be made idempotent. */
  readonly sessionIds: readonly WorkoutId[];
}

export interface TrainingVolumeAggregate {
  readonly kind: 'training_volume';
  readonly weeks: readonly WeeklyVolumeBucket[];
  /** Rolled-up weeks past retention, keyed `YYYY-MM`. */
  readonly monthlyVolumeKg: Readonly<Record<string, number>>;
}

/** One session's best effort on one exercise. The point on a progress line. */
export interface ExerciseProgressPoint {
  readonly localDate: LocalDate;
  readonly workoutId: WorkoutId;
  /** Estimated one-rep max from the session's best completed working set. */
  readonly e1rmKg: number;
  readonly topSetLoadKg: number;
  readonly topSetReps: number;
  readonly totalVolumeKg: number;
  readonly workingSetCount: number;
}

export interface ExerciseProgressSeries {
  /** `exerciseKey(ref)` — variants get their own series. */
  readonly exerciseKey: string;
  readonly exerciseId: ExerciseId;
  readonly displayName: string;
  /** Oldest first. Downsampled to weekly bests past the retention window. */
  readonly points: readonly ExerciseProgressPoint[];
  readonly lastPerformedOn: LocalDate | null;
}

export interface ExerciseProgressAggregate {
  readonly kind: 'exercise_progress';
  readonly series: readonly ExerciseProgressSeries[];
}

export interface PersonalRecordsAggregate {
  readonly kind: 'personal_records';
  /** Every achievement, newest first, across every exercise. Feeds the PR timeline. */
  readonly achievements: readonly PrAchievement[];
  readonly byExerciseKey: Readonly<Record<string, readonly PrAchievement[]>>;
}

export interface StreakState {
  readonly currentDays: number;
  readonly longestDays: number;
  readonly lastQualifyingDate: LocalDate | null;
  /**
   * Streaks are computed in the user's local calendar, so a session at 23:50 counts
   * for that day and a flight across the date line does not break a streak.
   */
  readonly timeZone: string | null;
}

export interface WeeklyAdherenceBucket {
  readonly week: IsoWeek;
  readonly plannedSessions: number;
  readonly completedSessions: number;
  /** Prescribed sets actually completed, as a fraction. Null when nothing was planned. */
  readonly prescriptionCompliance: number | null;
}

export interface AdherenceAggregate {
  readonly kind: 'adherence';
  readonly trainingStreak: StreakState;
  readonly weeks: readonly WeeklyAdherenceBucket[];
  readonly habitStreaks: Readonly<Record<HabitId, StreakState>>;
  /** Dates with at least one completed session. Drives the calendar heatmap. */
  readonly activeDates: readonly LocalDate[];
}

export interface DailyNutritionBucket {
  readonly localDate: LocalDate;
  readonly energyKcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
  readonly targetEnergyKcal: number | null;
  readonly targetProteinG: number | null;
  readonly entryCount: number;
}

export interface NutritionAggregate {
  readonly kind: 'nutrition';
  readonly days: readonly DailyNutritionBucket[];
  readonly weeklyAverageKcal: Readonly<Record<IsoWeek, number>>;
  /** Fraction of logged days that hit the protein target. */
  readonly proteinTargetHitRate: number | null;
  readonly loggingStreak: StreakState;
}

export type AggregateState =
  | TrainingVolumeAggregate
  | ExerciseProgressAggregate
  | PersonalRecordsAggregate
  | AdherenceAggregate
  | NutritionAggregate;

/** Maps an aggregate id to the state shape it produces. */
export interface AggregateStateById {
  readonly training_volume: TrainingVolumeAggregate;
  readonly exercise_progress: ExerciseProgressAggregate;
  readonly personal_records: PersonalRecordsAggregate;
  readonly adherence: AdherenceAggregate;
  readonly nutrition: NutritionAggregate;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * What a reducer is fed. One event per changed source document.
 *
 * `previous` is the document as the aggregate last saw it, or `null` on first sight;
 * `next` is the document now, or `null` on delete. Carrying both is what makes the
 * reducer a reversible delta rather than an accumulator, and therefore what makes a
 * replayed sync harmless.
 *
 * Payloads are typed loosely as the imported document types on purpose: the sync
 * layer hands over exactly what it read, and the reducer does the folding.
 */
export interface AggregateEventBase<TKind extends string, TDocument> {
  readonly kind: TKind;
  /** Source document id. Stable across previous/next. */
  readonly id: string;
  readonly previous: TDocument | null;
  readonly next: TDocument | null;
  /** Monotonic per-source sequence, used to drop out-of-order replays. */
  readonly sequence: number;
}

export type AggregateEvent =
  | AggregateEventBase<'workout', import('./schemas/workout.js').Workout>
  | AggregateEventBase<'routine', import('./schemas/routine.js').Routine>
  | AggregateEventBase<'personalRecord', import('./schemas/records.js').PersonalRecord>
  | AggregateEventBase<'bodyMetric', import('./schemas/body.js').BodyMetric>
  | AggregateEventBase<'nutritionDay', import('./schemas/nutrition.js').NutritionDay>
  | AggregateEventBase<'macroTarget', import('./schemas/nutrition.js').MacroTarget>
  | AggregateEventBase<'habitDay', import('./schemas/habits.js').HabitDay>
  | AggregateEventBase<'habit', import('./schemas/habits.js').Habit>;

export type AggregateEventKind = AggregateEvent['kind'];

/** Everything a full rebuild needs, read once from the local cache. */
export interface DomainSnapshot {
  readonly workouts: readonly import('./schemas/workout.js').Workout[];
  readonly routines: readonly import('./schemas/routine.js').Routine[];
  readonly personalRecords: readonly import('./schemas/records.js').PersonalRecord[];
  readonly bodyMetrics: readonly import('./schemas/body.js').BodyMetric[];
  readonly nutritionDays: readonly import('./schemas/nutrition.js').NutritionDay[];
  readonly macroTargets: readonly import('./schemas/nutrition.js').MacroTarget[];
  readonly habits: readonly import('./schemas/habits.js').Habit[];
  readonly habitDays: readonly import('./schemas/habits.js').HabitDay[];
  /** The user's IANA zone, needed to bucket anything by local day or week. */
  readonly timeZone: string;
}

// ---------------------------------------------------------------------------
// Reducer contract
// ---------------------------------------------------------------------------

/**
 * The signature the sync team implements, one per aggregate.
 *
 * Requirements, all of them testable and none of them optional:
 *
 * - `reduce` is **pure**. No clock, no random, no I/O. Same inputs, same output.
 * - `reduce` is **idempotent** for a given `sequence`: applying an event whose
 *   sequence is not greater than the one already folded in returns `state` unchanged.
 * - `reduce(empty(), …events)` equals `rebuild(snapshot)` for the documents those
 *   events describe. This is a property test, and it is the whole safety net —
 *   it is what turns aggregate drift into a caught bug rather than a wrong chart.
 * - `reduce` never throws on a malformed document. It skips it and reports it
 *   through `dropped`, because one bad row must not take out the insights tab.
 */
export interface AggregateReducer<TId extends AggregateId> {
  readonly id: TId;
  readonly version: number;
  /** Which events this reducer cares about. Everything else is skipped by the runner. */
  readonly handles: readonly AggregateEventKind[];
  /** The identity state. Must satisfy `reduce(empty(), e) === reduce(rebuild([]), e)`. */
  empty(): AggregateStateById[TId];
  reduce(state: AggregateStateById[TId], event: AggregateEvent): AggregateReduceResult<TId>;
  /** Full recomputation, for a version bump, a repair, or a cold device. */
  rebuild(snapshot: DomainSnapshot): AggregateStateById[TId];
}

export interface AggregateReduceResult<TId extends AggregateId> {
  readonly state: AggregateStateById[TId];
  /** Source ids the reducer refused, with a reason. Surfaced in diagnostics, not the UI. */
  readonly dropped: readonly { readonly id: string; readonly reason: string }[];
}

/** Convenience alias for a reducer of unknown id, e.g. in a registry. */
export type AnyAggregateReducer = { [K in AggregateId]: AggregateReducer<K> }[AggregateId];

// ---------------------------------------------------------------------------
// Persisted form
// ---------------------------------------------------------------------------

/**
 * Aggregates are also written to Firestore, one document per aggregate, under
 * `/users/{uid}/aggregates/{aggregateId}`.
 *
 * This looks like it contradicts "compute locally", and does not: a cold device that
 * has to replay two years of sessions to draw its first chart pays for every one of
 * those documents. Syncing the fold turns that into a single read. The local
 * computation is still the source of truth — this document is a cache that any
 * client can discard and rebuild.
 */
export const aggregateDocumentSchema = documentEnvelopeSchema.extend({
  id: aggregateIdSchema,
  /** Reducer version that produced `state`. A mismatch triggers a rebuild. */
  version: z.number().int().min(1).max(1000),
  /** Highest event sequence folded in, per source kind. Detects gaps. */
  sequenceByKind: z.record(z.string().max(32), z.number().int().min(0)),
  /** Last source document date included, for a cheap staleness check. */
  computedThrough: localDateSchema.optional(),
  computedAt: serverTimestampSchema,
  /**
   * The folded state. Opaque to the rules and validated by the reducer's own tests
   * rather than by Zod on read — it is derived data whose only consumer already
   * knows its shape, and parsing a two-year fold on every load is not free.
   */
  state: z.unknown(),
});

export type AggregateDocument = z.infer<typeof aggregateDocumentSchema>;
