import { z } from 'zod';
import { displayNameSchema, documentEnvelopeSchema, longTextSchema } from '../common/envelope.js';
import { exerciseIdSchema, exerciseVariantIdSchema } from '../common/ids.js';
import { massKgSchema } from '../common/units.js';

/**
 * Exercises.
 *
 * The catalogue ships on-device (ADR-0006) and is versioned with the app, so
 * Firestore stores only what the user created themselves. Anything logged carries an
 * {@link ExerciseRef} that records *which* source it came from, plus the name as it
 * read at the time, so that a catalogue update six months from now cannot rewrite
 * what a user's history says they did.
 */

export const MUSCLE_GROUPS = [
  'chest',
  'front_delts',
  'side_delts',
  'rear_delts',
  'lats',
  'upper_back',
  'traps',
  'lower_back',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'glutes',
  'quads',
  'hamstrings',
  'adductors',
  'abductors',
  'calves',
  'neck',
  'full_body',
] as const;

export const EQUIPMENT = [
  'barbell',
  'dumbbell',
  'kettlebell',
  'machine',
  'cable',
  'smith_machine',
  'bodyweight',
  'band',
  'trap_bar',
  'ez_bar',
  'plate',
  'sled',
  'sandbag',
  'medicine_ball',
  'suspension',
  'cardio_machine',
  'other',
] as const;

export const MOVEMENT_PATTERNS = [
  'squat',
  'hinge',
  'lunge',
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'carry',
  'rotation',
  'isolation',
  'cardio',
] as const;

export const MECHANICS = ['compound', 'isolation'] as const;
export const FORCE_VECTORS = ['push', 'pull', 'static'] as const;

/**
 * How an exercise is loaded. This drives plate maths, e1RM, and volume, and it is
 * the reason load is a union rather than a number: assisted pull-ups get *lighter*
 * as the stack goes up, so a naive `weightKg` field makes progress look like
 * regression on the one movement beginners use most.
 */
export const LOAD_KINDS = ['external', 'bodyweight', 'assisted', 'none'] as const;

/** What is being counted. Not every set has reps; a plank and a row do not compare. */
export const EFFORT_KINDS = ['reps', 'duration', 'distance', 'reps_and_duration'] as const;

export const EXERCISE_SOURCES = ['catalogue', 'custom'] as const;

export const muscleGroupSchema = z.enum(MUSCLE_GROUPS);
export const equipmentSchema = z.enum(EQUIPMENT);
export const movementPatternSchema = z.enum(MOVEMENT_PATTERNS);
export const mechanicSchema = z.enum(MECHANICS);
export const forceVectorSchema = z.enum(FORCE_VECTORS);
export const loadKindSchema = z.enum(LOAD_KINDS);
export const effortKindSchema = z.enum(EFFORT_KINDS);
export const exerciseSourceSchema = z.enum(EXERCISE_SOURCES);

export type MuscleGroup = z.infer<typeof muscleGroupSchema>;
export type Equipment = z.infer<typeof equipmentSchema>;
export type MovementPattern = z.infer<typeof movementPatternSchema>;
export type Mechanic = z.infer<typeof mechanicSchema>;
export type ForceVector = z.infer<typeof forceVectorSchema>;
export type LoadKind = z.infer<typeof loadKindSchema>;
export type EffortKind = z.infer<typeof effortKindSchema>;
export type ExerciseSource = z.infer<typeof exerciseSourceSchema>;

/**
 * Fractional contribution of a set on this exercise to a muscle group's volume.
 * A bench press is 1.0 chest and 0.5 triceps, not 1.0 of both — otherwise every
 * volume chart double-counts, and the number a user is trying to progress is wrong.
 */
export const muscleContributionSchema = z.strictObject({
  muscle: muscleGroupSchema,
  /** 0 to 1. Primary movers are 1, synergists a fraction. */
  fraction: z.number().min(0).max(1),
});

export type MuscleContribution = z.infer<typeof muscleContributionSchema>;

export const exerciseBodySchema = z.strictObject({
  name: displayNameSchema,
  /** Lowercased, accent-folded name for on-device search. Derived, never displayed. */
  searchName: z.string().min(1).max(120),
  source: exerciseSourceSchema,
  equipment: equipmentSchema,
  mechanic: mechanicSchema,
  force: forceVectorSchema,
  movementPattern: movementPatternSchema,
  loadKind: loadKindSchema,
  effortKind: effortKindSchema,
  /** Ordered most-primary first. Sums are not normalised; see {@link MuscleContribution}. */
  muscles: z.array(muscleContributionSchema).min(1).max(12),
  /** True when left and right are loaded separately, so volume counts both limbs. */
  unilateral: z.boolean(),
  /**
   * Mass of the empty implement in kg, when the user has to add it themselves —
   * an Olympic bar is 20, a Smith machine carriage is whatever that gym's is.
   * Absent means the logged load is already the total.
   */
  implementMassKg: massKgSchema.optional(),
  notes: longTextSchema.optional(),
  /** Catalogue release this row came from. Absent on custom exercises. */
  catalogueVersion: z.string().max(32).optional(),
});

/** A user-authored exercise. Catalogue exercises are bundled, not stored. */
export const exerciseSchema = documentEnvelopeSchema.extend(exerciseBodySchema.shape).extend({
  id: exerciseIdSchema,
  source: z.literal('custom'),
});

export type Exercise = z.infer<typeof exerciseSchema>;
export type ExerciseBody = z.infer<typeof exerciseBodySchema>;

/**
 * A variant is the same movement performed a materially different way — close grip,
 * paused, tempo, deficit, unilateral. It gets its own identity because it gets its
 * own personal record: a paused bench PR is not a bench PR, and merging them makes
 * the number meaningless.
 */
export const exerciseVariantSchema = z.strictObject({
  id: exerciseVariantIdSchema,
  exerciseId: exerciseIdSchema,
  name: displayNameSchema,
  /** Free-form modifiers, e.g. `{ grip: 'close', tempo: '3-1-1' }`. Bounded. */
  modifiers: z.record(z.string().max(32), z.string().max(64)),
  /** Overrides the parent exercise's muscle split when the variant genuinely differs. */
  muscles: z.array(muscleContributionSchema).min(1).max(12).optional(),
});

export type ExerciseVariant = z.infer<typeof exerciseVariantSchema>;

/**
 * How a logged set points at an exercise.
 *
 * `name` is denormalised deliberately (ADR-0005: avoid the read). It is also the
 * only correct choice: history must render offline, from one document, and must not
 * change wording when the bundled catalogue is rebuilt.
 */
export const exerciseRefSchema = z.strictObject({
  source: exerciseSourceSchema,
  exerciseId: exerciseIdSchema,
  variantId: exerciseVariantIdSchema.optional(),
  /** Name as it read when this was logged. Display only; never used for matching. */
  name: displayNameSchema,
  loadKind: loadKindSchema,
  effortKind: effortKindSchema,
  /** Copied at log time so volume aggregates never need a catalogue lookup. */
  muscles: z.array(muscleContributionSchema).min(1).max(12),
  unilateral: z.boolean(),
});

export type ExerciseRef = z.infer<typeof exerciseRefSchema>;

/**
 * The identity a personal record is tracked against. Variants split, everything else
 * merges. Used as a document id, so it must stay URL-safe.
 */
export function exerciseKey(ref: Pick<ExerciseRef, 'exerciseId' | 'variantId'>): string {
  return ref.variantId === undefined ? ref.exerciseId : `${ref.exerciseId}~${ref.variantId}`;
}
