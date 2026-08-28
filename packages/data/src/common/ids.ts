import { z } from 'zod';

/**
 * Branded identifiers.
 *
 * Every id in this domain is a client-generated, URL-safe, sortable string. It is
 * generated on the device, never by the server: a user must be able to start a
 * workout and log a set with no network (ADR-0009 puts a uid in hand on first open,
 * ADR-0005 makes the local cache the source of truth during a session), which means
 * the id has to exist before any write reaches Firestore.
 *
 * Ids are branded so that a `WorkoutId` cannot be passed where an `ExerciseId` is
 * expected. The brand is erased at runtime.
 */

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Shape shared by every id schema: URL-safe, bounded, non-empty. */
const rawId = z.string().regex(ID_PATTERN, 'id must be 1-64 URL-safe characters');

export const userIdSchema = rawId.brand<'UserId'>();
export const exerciseIdSchema = rawId.brand<'ExerciseId'>();
export const exerciseVariantIdSchema = rawId.brand<'ExerciseVariantId'>();
export const workoutIdSchema = rawId.brand<'WorkoutId'>();
export const workoutExerciseIdSchema = rawId.brand<'WorkoutExerciseId'>();
export const setIdSchema = rawId.brand<'SetId'>();
export const routineIdSchema = rawId.brand<'RoutineId'>();
export const programDayIdSchema = rawId.brand<'ProgramDayId'>();
export const personalRecordIdSchema = rawId.brand<'PersonalRecordId'>();
export const bodyMetricIdSchema = rawId.brand<'BodyMetricId'>();
export const progressPhotoIdSchema = rawId.brand<'ProgressPhotoId'>();
export const foodItemIdSchema = rawId.brand<'FoodItemId'>();
export const foodLogEntryIdSchema = rawId.brand<'FoodLogEntryId'>();
export const mealIdSchema = rawId.brand<'MealId'>();
export const recipeIdSchema = rawId.brand<'RecipeId'>();
export const macroTargetIdSchema = rawId.brand<'MacroTargetId'>();
export const habitIdSchema = rawId.brand<'HabitId'>();
export const coachGrantIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}__[A-Za-z0-9_-]{1,64}$/, 'grant id must be `${ownerUid}__${coachUid}`')
  .brand<'CoachGrantId'>();

export type UserId = z.infer<typeof userIdSchema>;
export type ExerciseId = z.infer<typeof exerciseIdSchema>;
export type ExerciseVariantId = z.infer<typeof exerciseVariantIdSchema>;
export type WorkoutId = z.infer<typeof workoutIdSchema>;
export type WorkoutExerciseId = z.infer<typeof workoutExerciseIdSchema>;
export type SetId = z.infer<typeof setIdSchema>;
export type RoutineId = z.infer<typeof routineIdSchema>;
export type ProgramDayId = z.infer<typeof programDayIdSchema>;
export type PersonalRecordId = z.infer<typeof personalRecordIdSchema>;
export type BodyMetricId = z.infer<typeof bodyMetricIdSchema>;
export type ProgressPhotoId = z.infer<typeof progressPhotoIdSchema>;
export type FoodItemId = z.infer<typeof foodItemIdSchema>;
export type FoodLogEntryId = z.infer<typeof foodLogEntryIdSchema>;
export type MealId = z.infer<typeof mealIdSchema>;
export type RecipeId = z.infer<typeof recipeIdSchema>;
export type MacroTargetId = z.infer<typeof macroTargetIdSchema>;
export type HabitId = z.infer<typeof habitIdSchema>;
export type CoachGrantId = z.infer<typeof coachGrantIdSchema>;

/**
 * The document id of a coach grant is derived, not random, so that a security rule
 * can resolve it with a single `get()` instead of a query. See SCHEMA.md.
 */
export function coachGrantId(ownerUid: UserId, coachUid: UserId): CoachGrantId {
  return `${ownerUid}__${coachUid}` as CoachGrantId;
}
