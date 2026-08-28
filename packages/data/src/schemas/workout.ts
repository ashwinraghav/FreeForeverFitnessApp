import { z } from 'zod';
import {
  displayNameSchema,
  documentEnvelopeSchema,
  shortTextSchema,
} from '../common/envelope.js';
import {
  programDayIdSchema,
  routineIdSchema,
  setIdSchema,
  workoutExerciseIdSchema,
  workoutIdSchema,
} from '../common/ids.js';
import { sortKeySchema } from '../common/sortKey.js';
import { epochMillisSchema, localDateSchema, tzOffsetMinutesSchema } from '../common/time.js';
import {
  distanceMetresSchema,
  durationSecondsSchema,
  massKgSchema,
  signedMassKgSchema,
} from '../common/units.js';
import { exerciseRefSchema, muscleGroupSchema } from './exercise.js';

/**
 * The workout session — the document the whole app exists to produce.
 *
 * A session, its exercises and every one of its sets live in **one Firestore
 * document**. See SCHEMA.md for the cost reasoning; the short version is that a
 * session is edited as a unit, so it should sync as a unit, and one document is one
 * read on a cold device instead of one plus one per set.
 */

/**
 * A set's load. A union rather than a nullable number, because the three loading
 * modes are not the same measurement:
 *
 *   external   — the weight on the bar or stack.
 *   bodyweight — what the user added to themselves. Total load needs their bodyweight,
 *                which is snapshotted on the session, not looked up later.
 *   assisted   — how much the machine took *off*. More assistance is less work, so
 *                this number goes down as the user gets stronger.
 *   none       — a bodyweight-only set with nothing added.
 */
export const setLoadSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('external'), weightKg: massKgSchema }),
  z.strictObject({ kind: z.literal('bodyweight'), addedWeightKg: signedMassKgSchema }),
  z.strictObject({ kind: z.literal('assisted'), assistanceKg: massKgSchema }),
  z.strictObject({ kind: z.literal('none') }),
]);

export type SetLoad = z.infer<typeof setLoadSchema>;

/** What the set counted. A plank and a row do not share a unit. */
export const setEffortSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('reps'), reps: z.number().int().min(0).max(1000) }),
  z.strictObject({ kind: z.literal('duration'), durationSec: durationSecondsSchema }),
  z.strictObject({
    kind: z.literal('distance'),
    distanceM: distanceMetresSchema,
    durationSec: durationSecondsSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('reps_and_duration'),
    reps: z.number().int().min(0).max(1000),
    durationSec: durationSecondsSchema,
  }),
]);

export type SetEffort = z.infer<typeof setEffortSchema>;

/**
 * Warmup is a *type*, not a boolean beside one.
 *
 * A `isWarmup: true` flag next to `type: 'drop'` is a contradiction the type system
 * would happily accept and the volume aggregate would silently mis-total. One enum
 * cannot disagree with itself. {@link isWarmupSet} gives callers the flag they
 * wanted without letting anyone store a second, divergent copy of it.
 */
export const SET_TYPES = [
  'warmup',
  'working',
  'top',
  'backoff',
  'drop',
  'amrap',
  'myorep',
  'cluster',
] as const;

export const setTypeSchema = z.enum(SET_TYPES);
export type SetType = z.infer<typeof setTypeSchema>;

/**
 * Three states, because a boolean cannot say what a training log needs to say.
 *
 *   pending   — prescribed or added, not attempted yet. The default.
 *   completed — attempted, and the user counted it as made.
 *   failed    — attempted, and it did not go. A missed rep, a bail, form gone.
 *
 * The distinction is load-bearing, not cosmetic: a failed set is real work and
 * counts toward volume and fatigue, but it must never set a personal record and it
 * is exactly the signal a progression scheme reads to decide not to add weight.
 * Collapsing failed into "not completed" throws that away; collapsing it into
 * "completed" inflates every chart.
 */
export const SET_STATES = ['pending', 'completed', 'failed'] as const;

export const setStateSchema = z.enum(SET_STATES);
export type SetState = z.infer<typeof setStateSchema>;

export const SET_TAGS = ['to_failure', 'partials', 'paused', 'assisted_reps', 'pr_attempt'] as const;
export const setTagSchema = z.enum(SET_TAGS);
export type SetTag = z.infer<typeof setTagSchema>;

/**
 * How hard it was. Stored on the scale the user actually entered rather than
 * normalised on the way in — RPE 8 and 2 RIR are equal by table and not equal as
 * evidence, and a user who logs in RIR should see RIR back.
 */
export const effortRatingSchema = z.discriminatedUnion('scale', [
  // RPE 5–10 in half steps; below 5 is not meaningfully reportable.
  z.strictObject({ scale: z.literal('rpe'), value: z.number().min(5).max(10).multipleOf(0.5) }),
  z.strictObject({ scale: z.literal('rir'), value: z.number().int().min(0).max(10) }),
]);

export type EffortRating = z.infer<typeof effortRatingSchema>;

/** What a routine prescribed for this set, kept beside what actually happened. */
export const setTargetSchema = z.strictObject({
  load: setLoadSchema.optional(),
  effort: setEffortSchema.optional(),
  effortRating: effortRatingSchema.optional(),
  /** Prescribed rep range, when the routine gave one rather than a fixed number. */
  repRange: z
    .strictObject({ min: z.number().int().min(1).max(1000), max: z.number().int().min(1).max(1000) })
    .refine((range) => range.min <= range.max, 'repRange.min must be <= repRange.max')
    .optional(),
});

export type SetTarget = z.infer<typeof setTargetSchema>;

export const setEntrySchema = z
  .strictObject({
    /** Stable for the life of the set. Generated on device, survives reorder and sync. */
    id: setIdSchema,
    /** Position. See `common/sortKey.ts` for why this is not an integer. */
    sortKey: sortKeySchema,
    type: setTypeSchema,
    state: setStateSchema,
    load: setLoadSchema,
    effort: setEffortSchema,
    target: setTargetSchema.optional(),
    effortRating: effortRatingSchema.optional(),
    /** Rest taken before this set, measured by the app, not prescribed. */
    restSecBefore: durationSecondsSchema.optional(),
    /** Device wall clock. Present if and only if the set has been attempted. */
    performedAt: epochMillisSchema.optional(),
    tags: z.array(setTagSchema).max(SET_TAGS.length).optional(),
    note: shortTextSchema.optional(),
  })
  .refine(
    (set) => (set.state === 'pending') === (set.performedAt === undefined),
    'performedAt must be set if and only if the set has been attempted',
  );

export type SetEntry = z.infer<typeof setEntrySchema>;

/** True for warmup sets. Derived from `type` so it can never disagree with it. */
export function isWarmupSet(set: Pick<SetEntry, 'type'>): boolean {
  return set.type === 'warmup';
}

/** A set that counts toward volume, fatigue and progression. Warmups do not. */
export function isWorkingSet(set: Pick<SetEntry, 'type'>): boolean {
  return set.type !== 'warmup';
}

/** A set that may set a record. A failed set never does, however heavy. */
export function isRecordEligible(set: Pick<SetEntry, 'type' | 'state'>): boolean {
  return set.state === 'completed' && isWorkingSet(set);
}

/** Upper bounds, mirrored as hard limits in `firestore.rules`. */
export const MAX_EXERCISES_PER_WORKOUT = 40;
export const MAX_SETS_PER_EXERCISE = 50;
export const MAX_SETS_PER_WORKOUT = 400;

export const workoutExerciseSchema = z.strictObject({
  id: workoutExerciseIdSchema,
  sortKey: sortKeySchema,
  exercise: exerciseRefSchema,
  sets: z.array(setEntrySchema).max(MAX_SETS_PER_EXERCISE),
  /**
   * Exercises sharing a group id are alternated. A short opaque token rather than an
   * index, so inserting an exercise between two supersets does not renumber them.
   */
  supersetGroup: z.string().max(16).optional(),
  targetRestSec: durationSecondsSchema.optional(),
  note: shortTextSchema.optional(),
  /** Where this came from, when the session was started from a routine. */
  plannedFrom: z
    .strictObject({ routineId: routineIdSchema, programDayId: programDayIdSchema })
    .optional(),
});

export type WorkoutExercise = z.infer<typeof workoutExerciseSchema>;

export const WORKOUT_STATUSES = ['in_progress', 'completed', 'discarded'] as const;
export const workoutStatusSchema = z.enum(WORKOUT_STATUSES);
export type WorkoutStatus = z.infer<typeof workoutStatusSchema>;

/**
 * Totals denormalised onto the session at write time.
 *
 * Under ADR-0005 nothing may query Firestore to draw a chart, so a week's volume has
 * to be summable from documents the client already holds without re-walking every
 * set. These fields make weekly and monthly rollups an addition over sessions.
 * They are derived — the sets are the truth — and the aggregate reducer recomputes
 * them if they ever drift.
 */
/**
 * A partial map from muscle group to a number. Keyed by string rather than by the
 * enum so that absent muscles stay absent — an exhaustive record would force every
 * session to carry twenty-one zeroes it does not need.
 */
export const muscleVolumeMapSchema = z
  .record(z.string().max(32), z.number().min(0).max(10_000_000))
  .refine(
    (map) => Object.keys(map).every((key) => muscleGroupSchema.safeParse(key).success),
    'every key must be a muscle group',
  );

export type MuscleVolumeMap = Partial<Record<z.infer<typeof muscleGroupSchema>, number>>;

export const workoutTotalsSchema = z.strictObject({
  exerciseCount: z.number().int().min(0).max(MAX_EXERCISES_PER_WORKOUT),
  setCount: z.number().int().min(0).max(MAX_SETS_PER_WORKOUT),
  workingSetCount: z.number().int().min(0).max(MAX_SETS_PER_WORKOUT),
  completedSetCount: z.number().int().min(0).max(MAX_SETS_PER_WORKOUT),
  failedSetCount: z.number().int().min(0).max(MAX_SETS_PER_WORKOUT),
  /** Sum of load x reps over completed working sets, kg. */
  volumeKg: z.number().min(0).max(10_000_000),
  /** Same, split by the muscle fractions on each exercise. Absent muscles are zero. */
  volumeKgByMuscle: muscleVolumeMapSchema,
  /** Wall-clock length of the session, excluding nothing. */
  durationSec: durationSecondsSchema,
});

export type WorkoutTotals = z.infer<typeof workoutTotalsSchema>;

export const workoutSchema = documentEnvelopeSchema
  .extend({
    id: workoutIdSchema,
    status: workoutStatusSchema,
    title: displayNameSchema,
    /** Device wall clock at the first tap. Display truth; not sync ordering. */
    startedAt: epochMillisSchema,
    endedAt: epochMillisSchema.optional(),
    /** The user's own calendar day. See `common/time.ts`. */
    localDate: localDateSchema,
    tzOffsetMinutes: tzOffsetMinutesSchema,
    exercises: z.array(workoutExerciseSchema).max(MAX_EXERCISES_PER_WORKOUT),
    totals: workoutTotalsSchema,
    /**
     * Bodyweight at the time of the session. Snapshotted because pull-up load depends
     * on it, and looking it up later would rewrite history every time the user
     * weighed themselves.
     */
    bodyweightKg: massKgSchema.optional(),
    programRef: z
      .strictObject({
        routineId: routineIdSchema,
        programDayId: programDayIdSchema,
        weekIndex: z.number().int().min(0).max(520),
      })
      .optional(),
    note: shortTextSchema.optional(),
    /** Session RPE, the one number worth asking for after a session. */
    sessionRpe: z.number().min(1).max(10).multipleOf(0.5).optional(),
  })
  .refine(
    (workout) => workout.endedAt === undefined || workout.endedAt >= workout.startedAt,
    'endedAt must not precede startedAt',
  )
  .refine(
    (workout) => (workout.status === 'in_progress') === (workout.endedAt === undefined),
    'a session has an endedAt if and only if it is no longer in progress',
  )
  .refine(
    (workout) =>
      workout.exercises.reduce((total, exercise) => total + exercise.sets.length, 0) <=
      MAX_SETS_PER_WORKOUT,
    `a session may hold at most ${MAX_SETS_PER_WORKOUT} sets`,
  );

export type Workout = z.infer<typeof workoutSchema>;
