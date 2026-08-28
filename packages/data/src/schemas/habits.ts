import { z } from 'zod';
import { displayNameSchema, documentEnvelopeSchema, shortTextSchema } from '../common/envelope.js';
import { habitIdSchema } from '../common/ids.js';
import { epochMillisSchema, localDateSchema, tzOffsetMinutesSchema } from '../common/time.js';

/**
 * Habits.
 *
 * Definitions are their own documents because they are few and long-lived. Entries
 * are grouped into one document per local day, because they are many and short-lived
 * and a day of them is always read together — the same shape as nutrition days, for
 * the same cost reason.
 */

export const HABIT_KINDS = [
  /** Did it or did not. */
  'boolean',
  /** A count against a target: eight glasses, ten thousand steps. */
  'count',
  /** Minutes against a target: twenty minutes of mobility. */
  'duration',
] as const;

export const habitKindSchema = z.enum(HABIT_KINDS);
export type HabitKind = z.infer<typeof habitKindSchema>;

export const HABIT_CADENCES = ['daily', 'weekly', 'specific_days'] as const;
export const habitCadenceSchema = z.enum(HABIT_CADENCES);
export type HabitCadence = z.infer<typeof habitCadenceSchema>;

export const habitSchema = documentEnvelopeSchema
  .extend({
    id: habitIdSchema,
    name: displayNameSchema,
    kind: habitKindSchema,
    cadence: habitCadenceSchema,
    /** 1 = Monday. Required when cadence is `specific_days`. */
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
    /** Times per week, when cadence is `weekly`. */
    timesPerWeek: z.number().int().min(1).max(21).optional(),
    /** Target value for `count` and `duration` habits. Meaningless for `boolean`. */
    targetValue: z.number().min(0).max(100_000).optional(),
    /** Unit label for display only — the value itself is the canonical number. */
    unitLabel: z.string().max(24).optional(),
    archivedOn: localDateSchema.optional(),
    note: shortTextSchema.optional(),
  })
  .refine(
    (habit) => habit.cadence !== 'specific_days' || (habit.weekdays?.length ?? 0) > 0,
    'a specific_days habit must name its days',
  )
  .refine(
    (habit) => habit.kind === 'boolean' || habit.targetValue !== undefined,
    'a count or duration habit needs a target',
  );

export type Habit = z.infer<typeof habitSchema>;

/**
 * Four states, for the same reason a set has three: "not done yet" and "deliberately
 * skipped" and "missed" are different facts, and a streak that treats today's
 * not-yet as a break is a streak nobody trusts.
 */
export const HABIT_STATUSES = ['pending', 'done', 'skipped', 'missed'] as const;
export const habitStatusSchema = z.enum(HABIT_STATUSES);
export type HabitStatus = z.infer<typeof habitStatusSchema>;

export const habitEntrySchema = z.strictObject({
  habitId: habitIdSchema,
  status: habitStatusSchema,
  /** Progress for `count` and `duration` habits. */
  value: z.number().min(0).max(100_000).optional(),
  /** Target snapshotted at the time, so editing the habit does not rewrite streaks. */
  targetValue: z.number().min(0).max(100_000).optional(),
  completedAt: epochMillisSchema.optional(),
  note: shortTextSchema.optional(),
});

export type HabitEntry = z.infer<typeof habitEntrySchema>;

export const MAX_HABITS_PER_DAY = 30;

export const habitDaySchema = documentEnvelopeSchema
  .extend({
    /** Equals the local date. `YYYY-MM-DD`. */
    id: localDateSchema,
    localDate: localDateSchema,
    tzOffsetMinutes: tzOffsetMinutesSchema,
    entries: z.array(habitEntrySchema).max(MAX_HABITS_PER_DAY),
  })
  .refine((day) => day.id === day.localDate, 'a habit day document id must equal its localDate')
  .refine(
    (day) => new Set(day.entries.map((entry) => entry.habitId)).size === day.entries.length,
    'a habit may appear at most once per day',
  );

export type HabitDay = z.infer<typeof habitDaySchema>;
