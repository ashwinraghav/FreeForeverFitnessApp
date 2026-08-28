import type {
  MacroTargetValues,
  MealSlot,
  NutrientProfile,
  Serving,
} from '@freeforever/core/src/nutrition/index.js';

/**
 * The nutrition feature's local document shapes.
 *
 * These are the *bodies* of the schemas in
 * `packages/data/src/schemas/nutrition.ts`, without the sync envelope (`sv`,
 * `uid`, `createdAt`, `updatedAt`). The envelope is written by the sync layer
 * when a document leaves the device; the feature never invents a server
 * timestamp, and the types here have no slot for one.
 *
 * Every quantity is canonical: grams, millilitres, kilocalories. No field here
 * ever holds a display-formatted value — a number that has been through
 * `format.ts` is a string on its way to the DOM and never comes back.
 */

/** A device-local `YYYY-MM-DD`. Mirrors `localDateSchema` without the brand. */
export type LocalDate = string;

/**
 * How a food is addressed across recents, favourites and the log.
 *
 * For a bundled food this is the index's own `shard:sourceId`, which is stable
 * across index versions (a numeric record id is not). Custom foods and recipes
 * get their own namespace so the three can never collide.
 */
export type FoodKey = string;

export type FoodSource = 'bundled' | 'custom' | 'barcode' | 'recipe';

export interface FoodRef {
  source: FoodSource;
  foodId: string;
  /** Name as it read when logged. Display only — never matched on. */
  name: string;
  brand?: string;
}

/**
 * Everything needed to log a food again without touching the index.
 *
 * Deliberately fat. A recents row that had to resolve its food through the
 * index before it could be logged would be a lookup on the app's most
 * latency-sensitive tap, and would break entirely for a food the index dropped
 * at the next rebuild. Carrying the nutrients here makes the repeat-log path a
 * pure function of data already in hand.
 */
export interface FoodSnapshot {
  key: FoodKey;
  ref: FoodRef;
  nutrientsPer100g: NutrientProfile;
  servings: Serving[];
  densityGPerMl?: number;
  barcode?: string;
  /** Licence attribution link. Rendering it for an OFF food is an obligation. */
  attributionUrl?: string;
  /** Upstream flags worth surfacing: estimated serving, derived energy, mismatch. */
  flags?: {
    servingEstimated: boolean;
    energyDerived: boolean;
    atwaterMismatch: boolean;
    highConfidence: boolean;
  };
}

/** A logged entry. Immutable evidence: it carries its own absolute nutrients. */
export interface LogEntry {
  id: string;
  sortKey: string;
  food: FoodRef;
  quantity: number;
  serving: Serving;
  /** `quantity × serving.gramsPerServing`. The canonical amount eaten. */
  massG: number;
  /** Already multiplied out. What the day totals sum. Never re-derived. */
  nutrients: NutrientProfile;
  loggedAt: number;
  note?: string;
}

export interface Meal {
  id: string;
  sortKey: string;
  slot: MealSlot;
  name?: string;
  entries: LogEntry[];
  /** Sum of `entries[].nutrients`, denormalised so a meal row needs no folding. */
  totals: NutrientProfile;
}

export interface NutritionDay {
  localDate: LocalDate;
  tzOffsetMinutes: number;
  meals: Meal[];
  totals: NutrientProfile;
  entryCount: number;
  waterMl: number;
  /** The target in force on this day, snapshotted so history is never re-judged. */
  targetSnapshot?: MacroTargetValues;
  note?: string;
}

/** A user-authored food, or one resolved from a barcode and kept. */
export interface CustomFood {
  id: string;
  name: string;
  brand?: string;
  source: 'custom' | 'barcode';
  nutrientsPer100g: NutrientProfile;
  servings: Serving[];
  densityGPerMl?: number;
  barcode?: string;
  /** The index row this was seeded from, for provenance. */
  externalRef?: string;
  createdAt: number;
}

export interface RecipeIngredient {
  sortKey: string;
  food: FoodRef;
  quantity: number;
  serving: Serving;
  massG: number;
  nutrients: NutrientProfile;
}

export interface Recipe {
  id: string;
  name: string;
  servings: number;
  ingredients: RecipeIngredient[];
  totalMassG: number;
  cookedMassG?: number;
  nutrientsPerServing: NutrientProfile;
  nutrientsPer100g: NutrientProfile;
  method?: string;
  createdAt: number;
}

/**
 * A food the user has logged before, with the portion and meal they last used.
 *
 * `logCount` and `lastLoggedAt` together drive the recents ordering. Both are
 * needed: count alone buries a food someone has started eating daily under one
 * they ate constantly last year, and recency alone loses the staples.
 */
export interface RecentFood {
  snapshot: FoodSnapshot;
  lastQuantity: number;
  lastServing: Serving;
  lastSlot: MealSlot;
  logCount: number;
  lastLoggedAt: number;
}

/** A whole meal the user saved to log again — "my usual breakfast". */
export interface SavedMeal {
  id: string;
  name: string;
  slot: MealSlot;
  entries: Omit<LogEntry, 'id' | 'loggedAt' | 'sortKey'>[];
  totals: NutrientProfile;
  createdAt: number;
}

export interface TargetPlan {
  /** The base target. What a flat week uses on every day. */
  base: MacroTargetValues;
  /** The binding safety floor for this user, from `calculateMacroTarget`. */
  energyFloorKcal: number;
  /** ISO weekdays, 1 = Monday. Empty means no per-day variation. */
  trainingDays: number[];
  swingFraction: number;
  source: 'manual' | 'calculated';
  basis?: {
    bmrKcal: number;
    tdeeKcal: number;
    rateKgPerWeek: number;
    bodyweightKg: number;
  };
  effectiveFrom: LocalDate;
}

export interface NutritionState {
  days: Record<LocalDate, NutritionDay>;
  customFoods: CustomFood[];
  recipes: Recipe[];
  savedMeals: SavedMeal[];
  /** Food keys the user starred. Order is the user's, not ours. */
  favourites: FoodKey[];
  recents: RecentFood[];
  target: TargetPlan | null;
  /** Display preferences that never touch stored values. */
  preferences: {
    energyUnit: 'kcal' | 'kJ';
    massUnit: 'g' | 'oz';
    showMicronutrients: boolean;
  };
}

export const EMPTY_STATE: NutritionState = {
  days: {},
  customFoods: [],
  recipes: [],
  savedMeals: [],
  favourites: [],
  recents: [],
  target: null,
  preferences: { energyUnit: 'kcal', massUnit: 'g', showMicronutrients: true },
};

/** Most recents any device keeps. Past this the list is noise, not a shortcut. */
export const MAX_RECENTS = 60;
