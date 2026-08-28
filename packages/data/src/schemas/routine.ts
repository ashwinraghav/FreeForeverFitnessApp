import { z } from 'zod';
import {
  displayNameSchema,
  documentEnvelopeSchema,
  longTextSchema,
  shortTextSchema,
} from '../common/envelope.js';
import { programDayIdSchema, routineIdSchema, workoutExerciseIdSchema } from '../common/ids.js';
import { sortKeySchema } from '../common/sortKey.js';
import { localDateSchema } from '../common/time.js';
import { durationSecondsSchema, massKgSchema } from '../common/units.js';
import { exerciseRefSchema } from './exercise.js';
import { setTargetSchema, setTypeSchema } from './workout.js';

/**
 * Routines (called programs when they run for a fixed block).
 *
 * A routine is a template, not a log. It holds its weeks and days inline for the
 * same reason a session holds its sets inline: it is read and edited whole, and a
 * routine that needs eight document reads to render its week view is a routine
 * nobody looks at on a phone.
 */

/**
 * How the next session's load is chosen. Every one of these is deterministic and
 * runs offline — ADR-0016 rule 2: the zero-cost path ships first, and an AI coach
 * may later suggest alongside these but never replaces them.
 */
export const PROGRESSION_KINDS = [
  /** Add a fixed increment when every prescribed rep was made. */
  'linear',
  /** Add weight only once the top of the rep range is hit on all sets. */
  'double_progression',
  /** Load derived from a training max and a percentage. */
  'percentage_of_max',
  /** Load adjusted to hit a target RPE, from the last session's reported effort. */
  'rpe_autoregulated',
  /** The user decides. Always available; never removed. */
  'manual',
] as const;

export const progressionKindSchema = z.enum(PROGRESSION_KINDS);
export type ProgressionKind = z.infer<typeof progressionKindSchema>;

export const progressionRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('linear'),
    incrementKg: massKgSchema,
    /** Consecutive failures before the rule backs the load off. */
    deloadAfterFailures: z.number().int().min(1).max(10),
    deloadFraction: z.number().min(0).max(1),
  }),
  z.strictObject({
    kind: z.literal('double_progression'),
    incrementKg: massKgSchema,
    repRange: z
      .strictObject({ min: z.number().int().min(1).max(100), max: z.number().int().min(1).max(100) })
      .refine((range) => range.min <= range.max, 'repRange.min must be <= repRange.max'),
  }),
  z.strictObject({
    kind: z.literal('percentage_of_max'),
    /** Fraction of the training max, e.g. 0.725. Not a display percentage. */
    fractionOfMax: z.number().min(0).max(2),
    /** Training max as a fraction of the true max, e.g. 0.9. */
    trainingMaxFraction: z.number().min(0).max(1),
  }),
  z.strictObject({
    kind: z.literal('rpe_autoregulated'),
    targetRpe: z.number().min(5).max(10).multipleOf(0.5),
    /** How much of the observed error to correct per session, 0–1. */
    dampingFactor: z.number().min(0).max(1),
  }),
  z.strictObject({ kind: z.literal('manual') }),
]);

export type ProgressionRule = z.infer<typeof progressionRuleSchema>;

export const plannedSetSchema = z.strictObject({
  sortKey: sortKeySchema,
  type: setTypeSchema,
  target: setTargetSchema,
});

export type PlannedSet = z.infer<typeof plannedSetSchema>;

export const plannedExerciseSchema = z.strictObject({
  id: workoutExerciseIdSchema,
  sortKey: sortKeySchema,
  exercise: exerciseRefSchema,
  sets: z.array(plannedSetSchema).max(50),
  progression: progressionRuleSchema,
  supersetGroup: z.string().max(16).optional(),
  targetRestSec: durationSecondsSchema.optional(),
  note: shortTextSchema.optional(),
});

export type PlannedExercise = z.infer<typeof plannedExerciseSchema>;

export const programDaySchema = z.strictObject({
  id: programDayIdSchema,
  sortKey: sortKeySchema,
  name: displayNameSchema,
  /**
   * Day of week, 1 = Monday, when the routine is calendar-bound. Absent means the
   * routine is sequence-bound — do day 3 whenever you next train — which is what most
   * people actually do and what most apps refuse to model.
   */
  weekday: z.number().int().min(1).max(7).optional(),
  /** A rest day is a real day in the plan, not a gap between days. */
  isRestDay: z.boolean(),
  exercises: z.array(plannedExerciseSchema).max(40),
  note: shortTextSchema.optional(),
});

export type ProgramDay = z.infer<typeof programDaySchema>;

export const programWeekSchema = z.strictObject({
  /** Zero-based position in the block. */
  index: z.number().int().min(0).max(519),
  name: displayNameSchema.optional(),
  /**
   * Multiplies prescribed load for the whole week. A deload week is 0.6, not a
   * separately authored set of days — which is what keeps a 12-week block editable.
   */
  loadMultiplier: z.number().min(0).max(2),
  /** Days are inherited from `days` on the routine unless a week overrides them. */
  days: z.array(programDaySchema).max(14).optional(),
  note: shortTextSchema.optional(),
});

export type ProgramWeek = z.infer<typeof programWeekSchema>;

export const ROUTINE_STATUSES = ['draft', 'active', 'archived'] as const;
export const routineStatusSchema = z.enum(ROUTINE_STATUSES);
export type RoutineStatus = z.infer<typeof routineStatusSchema>;

export const routineSchema = documentEnvelopeSchema
  .extend({
    id: routineIdSchema,
    name: displayNameSchema,
    status: routineStatusSchema,
    description: longTextSchema.optional(),
    /** The default day sequence. Weeks may override it. */
    days: z.array(programDaySchema).max(14),
    /**
     * Empty for an open-ended routine that repeats `days` forever. Non-empty for a
     * fixed block with per-week variation.
     */
    weeks: z.array(programWeekSchema).max(52),
    /** Set when the routine is running. Drives "what's next" without a query. */
    startedOn: localDateSchema.optional(),
    currentWeekIndex: z.number().int().min(0).max(519).optional(),
    currentDayIndex: z.number().int().min(0).max(13).optional(),
    /**
     * Provenance when the routine came from somewhere else — a shared routine inside
     * a closed group (ADR-0017) or a bundled template. There is no public directory
     * and this field never makes one.
     */
    origin: z
      .strictObject({
        kind: z.enum(['self', 'template', 'shared']),
        templateId: z.string().max(64).optional(),
      })
      .optional(),
  })
  .refine(
    (routine) => routine.status !== 'active' || routine.startedOn !== undefined,
    'an active routine must record when it started',
  )
  .refine(
    (routine) =>
      routine.currentWeekIndex === undefined ||
      routine.weeks.length === 0 ||
      routine.currentWeekIndex < routine.weeks.length,
    'currentWeekIndex must fall inside the block',
  );

export type Routine = z.infer<typeof routineSchema>;
