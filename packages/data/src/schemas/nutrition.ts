import { z } from 'zod';
import {
  displayNameSchema,
  documentEnvelopeSchema,
  longTextSchema,
  shortTextSchema,
} from '../common/envelope.js';
import {
  foodItemIdSchema,
  foodLogEntryIdSchema,
  macroTargetIdSchema,
  mealIdSchema,
  recipeIdSchema,
} from '../common/ids.js';
import { sortKeySchema } from '../common/sortKey.js';
import { epochMillisSchema, localDateSchema, tzOffsetMinutesSchema } from '../common/time.js';
import {
  energyKcalSchema,
  foodMassGramsSchema,
  massKgSchema,
  volumeMlSchema,
} from '../common/units.js';

/**
 * Nutrition.
 *
 * Two rules shape everything here.
 *
 * **Nutrients are stored per 100g, always.** Every public food dataset is per-100g,
 * every serving is a mass, and per-serving storage means re-deriving the base every
 * time a user edits a quantity. Volumes are converted to mass at log time using the
 * food's density; a millilitre of oil is not a gram.
 *
 * **A logged entry is immutable evidence.** It carries its own absolute nutrient
 * numbers, denormalised at the moment of logging, rather than a pointer into the
 * bundled dataset. The dataset ships with the app and is rebuilt (ADR-0006); if
 * entries pointed at it, shipping a corrected calorie count for oat milk would
 * rewrite what a user ate last March. It would also make every day view a fan-out of
 * lookups, which ADR-0005 forbids outright.
 */

/**
 * Per 100g of the food. Energy in kcal, macros in grams, micros in milligrams.
 * The four required fields are the ones every dataset has and every user sees;
 * everything else is optional because most rows genuinely do not have it.
 */
export const nutrientProfileSchema = z.strictObject({
  energyKcal: energyKcalSchema,
  proteinG: foodMassGramsSchema,
  carbsG: foodMassGramsSchema,
  fatG: foodMassGramsSchema,
  fiberG: foodMassGramsSchema.optional(),
  sugarG: foodMassGramsSchema.optional(),
  addedSugarG: foodMassGramsSchema.optional(),
  saturatedFatG: foodMassGramsSchema.optional(),
  transFatG: foodMassGramsSchema.optional(),
  monounsaturatedFatG: foodMassGramsSchema.optional(),
  polyunsaturatedFatG: foodMassGramsSchema.optional(),
  cholesterolMg: z.number().min(0).max(100_000).optional(),
  sodiumMg: z.number().min(0).max(100_000).optional(),
  potassiumMg: z.number().min(0).max(100_000).optional(),
  calciumMg: z.number().min(0).max(100_000).optional(),
  ironMg: z.number().min(0).max(10_000).optional(),
  alcoholG: foodMassGramsSchema.optional(),
});

export type NutrientProfile = z.infer<typeof nutrientProfileSchema>;

/** A named portion, defined by the mass it resolves to. Never by a display string. */
export const servingSchema = z.strictObject({
  /** "medium egg", "1 cup cooked", "1 scoop". */
  name: displayNameSchema,
  gramsPerServing: foodMassGramsSchema.min(0.01),
  /** Set for liquids logged by volume; `gramsPerServing` stays the canonical value. */
  millilitresPerServing: volumeMlSchema.optional(),
});

export type Serving = z.infer<typeof servingSchema>;

export const FOOD_SOURCES = [
  /** From the dataset bundled with the app (ADR-0006). */
  'bundled',
  /** Created by the user. */
  'custom',
  /** Resolved from a barcode against the long-tail endpoint, then cached as custom. */
  'barcode',
  /** A user recipe, logged as a single food. */
  'recipe',
] as const;

export const foodSourceSchema = z.enum(FOOD_SOURCES);
export type FoodSource = z.infer<typeof foodSourceSchema>;

export const foodItemBodySchema = z.strictObject({
  name: displayNameSchema,
  searchName: z.string().min(1).max(120),
  brand: z.string().max(120).optional(),
  source: foodSourceSchema,
  nutrientsPer100g: nutrientProfileSchema,
  servings: z.array(servingSchema).max(20),
  /** g/ml. Required to log a liquid by volume without guessing. */
  densityGPerMl: z.number().min(0.1).max(5).optional(),
  barcode: z.string().regex(/^\d{6,14}$/, 'barcode must be 6-14 digits').optional(),
  /** Dataset row this was copied from, for provenance and dedupe. */
  externalRef: z.string().max(64).optional(),
});

/** Only user-authored and barcode-resolved foods are stored; the catalogue is bundled. */
export const foodItemSchema = documentEnvelopeSchema.extend(foodItemBodySchema.shape).extend({
  id: foodItemIdSchema,
  source: z.enum(['custom', 'barcode']),
});

export type FoodItem = z.infer<typeof foodItemSchema>;
export type FoodItemBody = z.infer<typeof foodItemBodySchema>;

export const foodRefSchema = z.strictObject({
  source: foodSourceSchema,
  foodId: z.string().min(1).max(64),
  /** Name as it read when logged. Display only. */
  name: displayNameSchema,
  brand: z.string().max(120).optional(),
});

export type FoodRef = z.infer<typeof foodRefSchema>;

export const foodLogEntrySchema = z.strictObject({
  id: foodLogEntryIdSchema,
  sortKey: sortKeySchema,
  food: foodRefSchema,
  /** How many of `serving`. */
  quantity: z.number().min(0).max(1000),
  /** The portion as chosen, snapshotted so editing quantity does not need a lookup. */
  serving: servingSchema,
  /** `quantity * serving.gramsPerServing`, denormalised. The canonical amount eaten. */
  massG: foodMassGramsSchema,
  /**
   * Absolute nutrients for this entry — already multiplied out, not per 100g.
   * This is the immutable evidence: it is what the day totals sum, and it does not
   * move when the bundled dataset is rebuilt.
   */
  nutrients: nutrientProfileSchema,
  loggedAt: epochMillisSchema,
  note: shortTextSchema.optional(),
});

export type FoodLogEntry = z.infer<typeof foodLogEntrySchema>;

export const MEAL_SLOTS = [
  'breakfast',
  'lunch',
  'dinner',
  'snack',
  'pre_workout',
  'post_workout',
  'other',
] as const;

export const mealSlotSchema = z.enum(MEAL_SLOTS);
export type MealSlot = z.infer<typeof mealSlotSchema>;

export const MAX_MEALS_PER_DAY = 12;
export const MAX_ENTRIES_PER_MEAL = 50;
export const MAX_ENTRIES_PER_DAY = 150;

export const mealSchema = z.strictObject({
  id: mealIdSchema,
  sortKey: sortKeySchema,
  slot: mealSlotSchema,
  /** Overrides the slot label when the user named it. */
  name: displayNameSchema.optional(),
  entries: z.array(foodLogEntrySchema).max(MAX_ENTRIES_PER_MEAL),
  /** Sum of `entries[].nutrients`. Denormalised so a meal row renders without folding. */
  totals: nutrientProfileSchema,
});

export type Meal = z.infer<typeof mealSchema>;

/** The macro numbers themselves, separated so a target can be snapshotted onto a day. */
export const macroTargetValuesSchema = z.strictObject({
  energyKcal: energyKcalSchema,
  proteinG: foodMassGramsSchema,
  carbsG: foodMassGramsSchema,
  fatG: foodMassGramsSchema,
  fiberG: foodMassGramsSchema.optional(),
  waterMl: volumeMlSchema.optional(),
});

export type MacroTargetValues = z.infer<typeof macroTargetValuesSchema>;

export const GOALS = ['lose_fat', 'maintain', 'gain_muscle', 'recomp', 'performance'] as const;
export const goalSchema = z.enum(GOALS);
export type Goal = z.infer<typeof goalSchema>;

export const ACTIVITY_LEVELS = [
  'sedentary',
  'lightly_active',
  'moderately_active',
  'very_active',
  'extremely_active',
] as const;
export const activityLevelSchema = z.enum(ACTIVITY_LEVELS);
export type ActivityLevel = z.infer<typeof activityLevelSchema>;

/**
 * Targets are versioned rather than mutated: `effectiveFrom` and `status` mean a
 * change in January does not retroactively mark December as over-eating. Adherence
 * aggregates read the target that was in force on the day, which is why every
 * nutrition day also snapshots the values it was judged against.
 */
export const macroTargetSchema = documentEnvelopeSchema.extend({
  id: macroTargetIdSchema,
  effectiveFrom: localDateSchema,
  status: z.enum(['active', 'superseded']),
  values: macroTargetValuesSchema,
  source: z.enum(['manual', 'calculated']),
  /** How a calculated target was arrived at. Kept so the number is explicable. */
  basis: z
    .strictObject({
      tdeeKcal: energyKcalSchema,
      activityLevel: activityLevelSchema,
      goal: goalSchema,
      /** Intended rate of bodyweight change. Negative for a deficit. */
      rateKgPerWeek: z.number().min(-2).max(2),
      bodyweightKg: massKgSchema.optional(),
    })
    .optional(),
});

export type MacroTarget = z.infer<typeof macroTargetSchema>;

/**
 * One document per local day, holding every meal and entry for it.
 *
 * This is the central nutrition denormalisation. A day view is the highest-frequency
 * read in the app after the workout screen; as one document it is one read, one cache
 * entry, one offline write and one conflict domain. As `meals/*` plus `entries/*`
 * subcollections it would be twenty reads to render a Tuesday.
 */
export const nutritionDaySchema = documentEnvelopeSchema
  .extend({
    /** Equals the local date. `YYYY-MM-DD`. */
    id: localDateSchema,
    localDate: localDateSchema,
    tzOffsetMinutes: tzOffsetMinutesSchema,
    meals: z.array(mealSchema).max(MAX_MEALS_PER_DAY),
    /** Sum over every meal. What the ring on the home screen reads. */
    totals: nutrientProfileSchema,
    entryCount: z.number().int().min(0).max(MAX_ENTRIES_PER_DAY),
    /** Logged separately from food; a glass of water is not a meal. */
    waterMl: volumeMlSchema,
    /** The target in force on this day, snapshotted. See {@link macroTargetSchema}. */
    targetSnapshot: macroTargetValuesSchema.optional(),
    note: shortTextSchema.optional(),
  })
  .refine((day) => day.id === day.localDate, 'a nutrition day document id must equal its localDate')
  .refine(
    (day) => day.meals.reduce((total, meal) => total + meal.entries.length, 0) <= MAX_ENTRIES_PER_DAY,
    `a day may hold at most ${MAX_ENTRIES_PER_DAY} entries`,
  );

export type NutritionDay = z.infer<typeof nutritionDaySchema>;

export const recipeIngredientSchema = z.strictObject({
  sortKey: sortKeySchema,
  food: foodRefSchema,
  quantity: z.number().min(0).max(1000),
  serving: servingSchema,
  massG: foodMassGramsSchema,
  nutrients: nutrientProfileSchema,
});

export type RecipeIngredient = z.infer<typeof recipeIngredientSchema>;

export const recipeSchema = documentEnvelopeSchema
  .extend({
    id: recipeIdSchema,
    name: displayNameSchema,
    servings: z.number().min(0.1).max(100),
    ingredients: z.array(recipeIngredientSchema).max(60),
    /** Raw mass in. Differs from cooked mass, which is why both exist. */
    totalMassG: foodMassGramsSchema,
    /** Mass after cooking, when the user weighed it. Used for per-gram accuracy. */
    cookedMassG: foodMassGramsSchema.optional(),
    /** Derived from the ingredients, stored so logging the recipe needs no folding. */
    nutrientsPerServing: nutrientProfileSchema,
    nutrientsPer100g: nutrientProfileSchema,
    method: longTextSchema.optional(),
  })
  .refine(
    (recipe) => recipe.ingredients.length > 0,
    'a recipe needs at least one ingredient',
  );

export type Recipe = z.infer<typeof recipeSchema>;
