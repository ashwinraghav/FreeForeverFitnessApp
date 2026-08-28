/**
 * Structural types for the nutrition maths.
 *
 * These mirror `@freeforever/data`'s nutrition schemas field for field, and are
 * declared here rather than imported so that `@freeforever/core` keeps the
 * property its own README claims: deterministic and dependency-free. Values
 * produced here are structurally assignable to the Zod-inferred types, and
 * `nutrients.test.ts` pins that by validating outputs against the real schemas
 * is NOT possible without the dependency — so the mirror is asserted by hand in
 * `types.test.ts` instead, which fails if a field is added upstream.
 *
 * Every quantity is canonical (ADR: `packages/data/src/common/units.ts`):
 * energy in kcal, mass in grams, micronutrients in milligrams, volume in
 * millilitres. Nothing here ever returns a display string.
 */

/** Per 100 g of food, or per 100 ml when the source's basis is volumetric. */
export interface NutrientProfile {
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  sugarG?: number;
  addedSugarG?: number;
  saturatedFatG?: number;
  transFatG?: number;
  monounsaturatedFatG?: number;
  polyunsaturatedFatG?: number;
  cholesterolMg?: number;
  sodiumMg?: number;
  potassiumMg?: number;
  calciumMg?: number;
  ironMg?: number;
  alcoholG?: number;
}

/** A named portion, defined by the mass it resolves to. Never by a display string. */
export interface Serving {
  name: string;
  gramsPerServing: number;
  /** Set for liquids logged by volume. `gramsPerServing` stays canonical. */
  millilitresPerServing?: number;
}

export interface MacroTargetValues {
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  waterMl?: number;
}

/** Mirrors `GOALS` in `packages/data/src/schemas/nutrition.ts`. */
export const GOALS_LIST = [
  'lose_fat',
  'maintain',
  'gain_muscle',
  'recomp',
  'performance',
] as const;

export type Goal = (typeof GOALS_LIST)[number];

/** Mirrors `ACTIVITY_LEVELS` in `packages/data/src/schemas/nutrition.ts`. */
export const ACTIVITY_LEVELS_LIST = [
  'sedentary',
  'lightly_active',
  'moderately_active',
  'very_active',
  'extremely_active',
] as const;

export type ActivityLevel = (typeof ACTIVITY_LEVELS_LIST)[number];

/** Mirrors `BIOLOGICAL_SEX_VALUES` in `packages/data/src/schemas/profile.ts`. */
export const BIOLOGICAL_SEX_LIST = ['female', 'male', 'unspecified'] as const;

export type BiologicalSex = (typeof BIOLOGICAL_SEX_LIST)[number];

/** Mirrors `MEAL_SLOTS` in `packages/data/src/schemas/nutrition.ts`. */
export const MEAL_SLOTS = [
  'breakfast',
  'lunch',
  'dinner',
  'snack',
  'pre_workout',
  'post_workout',
  'other',
] as const;

export type MealSlot = (typeof MEAL_SLOTS)[number];

/** Schema caps, mirrored so the feature can enforce them before a write. */
export const MAX_MEALS_PER_DAY = 12;
export const MAX_ENTRIES_PER_MEAL = 50;
export const MAX_ENTRIES_PER_DAY = 150;

/**
 * The four fields every dataset has and every user sees. Kept separate from the
 * optional ones because "absent" and "zero" are different facts for a micro-
 * nutrient and the same fact for these.
 */
export const REQUIRED_NUTRIENT_FIELDS = [
  'energyKcal',
  'proteinG',
  'carbsG',
  'fatG',
] as const satisfies readonly (keyof NutrientProfile)[];

/**
 * Everything a dataset row may or may not carry. Absent stays absent through
 * arithmetic: a day built entirely from foods with no fibre figure reports no
 * fibre figure, rather than claiming a confident 0 g.
 */
export const OPTIONAL_NUTRIENT_FIELDS = [
  'fiberG',
  'sugarG',
  'addedSugarG',
  'saturatedFatG',
  'transFatG',
  'monounsaturatedFatG',
  'polyunsaturatedFatG',
  'cholesterolMg',
  'sodiumMg',
  'potassiumMg',
  'calciumMg',
  'ironMg',
  'alcoholG',
] as const satisfies readonly (keyof NutrientProfile)[];

export const NUTRIENT_FIELDS = [
  ...REQUIRED_NUTRIENT_FIELDS,
  ...OPTIONAL_NUTRIENT_FIELDS,
] as const;

export type RequiredNutrientField = (typeof REQUIRED_NUTRIENT_FIELDS)[number];
export type OptionalNutrientField = (typeof OPTIONAL_NUTRIENT_FIELDS)[number];
export type NutrientField = (typeof NUTRIENT_FIELDS)[number];

/** Energy yield per gram. Atwater general factors. */
export const KCAL_PER_GRAM = {
  protein: 4,
  carb: 4,
  fat: 9,
  /** Ethanol. Present so an alcoholic drink's macros do not appear to under-sum. */
  alcohol: 7,
} as const;
