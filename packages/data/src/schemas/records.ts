import { z } from 'zod';
import { documentEnvelopeSchema } from '../common/envelope.js';
import { personalRecordIdSchema, setIdSchema, workoutIdSchema } from '../common/ids.js';
import { epochMillisSchema, localDateSchema } from '../common/time.js';
import { distanceMetresSchema, durationSecondsSchema, massKgSchema } from '../common/units.js';
import { exerciseRefSchema } from './exercise.js';

/**
 * Personal records.
 *
 * One document per exercise (or exercise+variant — see `exerciseKey`), holding every
 * record type for it plus a capped history. The document id is derived from the
 * exercise key rather than random, which makes "did this set beat anything?" a
 * single cache hit on a known id instead of a query, and makes the write idempotent
 * when two devices detect the same PR offline.
 *
 * Records are only ever set by a **completed working set** (`isRecordEligible`). A
 * failed heavy single is not a record, and a warmup is not a record.
 */

export const PR_TYPES = [
  /** Heaviest load moved for at least one rep. */
  'heaviest_weight',
  /** Best estimated one-rep max across the set's load and reps. */
  'best_e1rm',
  /** Most reps at any load. */
  'most_reps',
  /** Highest load x reps in a single set. */
  'best_set_volume',
  /** Highest total volume for this exercise within one session. */
  'best_session_volume',
  /** Longest held, for timed work. */
  'best_duration',
  /** Furthest, for distance work. */
  'best_distance',
] as const;

export const prTypeSchema = z.enum(PR_TYPES);
export type PrType = z.infer<typeof prTypeSchema>;

export const prAchievementSchema = z.strictObject({
  type: prTypeSchema,
  /** Canonical value for the type: kg, reps, kg (volume), seconds or metres. */
  value: z.number().min(0).max(1_000_000),
  /** Context, so the number is readable without opening the session. */
  loadKg: massKgSchema.optional(),
  reps: z.number().int().min(0).max(1000).optional(),
  durationSec: durationSecondsSchema.optional(),
  distanceM: distanceMetresSchema.optional(),
  e1rmKg: massKgSchema.optional(),
  achievedOn: localDateSchema,
  achievedAt: epochMillisSchema,
  workoutId: workoutIdSchema,
  /** Absent for session-scoped records, which are not attributable to one set. */
  setId: setIdSchema.optional(),
  /** What this beat. Absent for a first record. */
  previousValue: z.number().min(0).max(1_000_000).optional(),
});

export type PrAchievement = z.infer<typeof prAchievementSchema>;

/** Records older than this fall out of the document and live only in the aggregate. */
export const MAX_PR_HISTORY = 100;

/** Rep maxes are tracked for these rep counts; beyond 12 the estimate is noise. */
export const TRACKED_REP_MAXES = [1, 2, 3, 5, 8, 10, 12] as const;

const prTypeKeyedMap = z
  .record(z.string().max(32), prAchievementSchema)
  .refine(
    (map) => Object.keys(map).every((key) => prTypeSchema.safeParse(key).success),
    'every key must be a PR type',
  );

const repMaxMap = z
  .record(z.string().max(4), massKgSchema)
  .refine(
    (map) => Object.keys(map).every((key) => (TRACKED_REP_MAXES as readonly number[]).includes(Number(key))),
    `rep max keys must be one of ${TRACKED_REP_MAXES.join(', ')}`,
  );

export const personalRecordSchema = documentEnvelopeSchema.extend({
  /** Equals `exerciseKey(exercise)`. Derived id, not random. */
  id: personalRecordIdSchema,
  exercise: exerciseRefSchema,
  /** Current best per type. Partial — an exercise never done for time has no duration PR. */
  current: prTypeKeyedMap,
  /** Heaviest load actually completed for exactly N reps, per tracked N. */
  repMaxKgByReps: repMaxMap,
  /** Oldest first, capped at {@link MAX_PR_HISTORY}. */
  history: z.array(prAchievementSchema).max(MAX_PR_HISTORY),
  lastAchievedOn: localDateSchema.optional(),
});

export type PersonalRecord = z.infer<typeof personalRecordSchema>;
export type PrCurrentMap = Partial<Record<PrType, PrAchievement>>;
export type RepMaxMap = Partial<Record<`${(typeof TRACKED_REP_MAXES)[number]}`, number>>;
