import { addNutrients, multiplyNutrients, roundTo, zeroNutrients } from './nutrients.js';
import type { NutrientProfile } from './types.js';

/**
 * Recipes.
 *
 * A recipe is a food the user assembles once and then logs like any other. The
 * only subtlety is cooked mass: a stew loses water, so 200 g of the finished
 * dish is denser in everything than 200 g of the ingredients that went in.
 * Ignoring that is the standard error, and it understates a reduced sauce badly.
 */

export interface RecipeIngredientLike {
  massG: number;
  nutrients: NutrientProfile;
}

export interface RecipeTotals {
  /** Raw mass in — the sum of the ingredients. */
  totalMassG: number;
  /** Nutrients for the whole recipe. */
  total: NutrientProfile;
  nutrientsPerServing: NutrientProfile;
  /**
   * Per 100 g of the food as *eaten*. Uses cooked mass when the user weighed
   * the finished dish, raw mass otherwise.
   */
  nutrientsPer100g: NutrientProfile;
  /** The mass the per-100 g figure is relative to. Surfaced so the UI can say which. */
  basisMassG: number;
  /** True when `basisMassG` came from a weighed cooked mass rather than the sum. */
  usedCookedMass: boolean;
}

/**
 * Fold a recipe's ingredients into the three denormalised figures the schema
 * stores, so logging a recipe needs no folding at log time.
 *
 * @param servings how many portions the recipe makes
 * @param cookedMassG mass of the finished dish, when the user weighed it
 */
export function computeRecipeTotals(input: {
  ingredients: readonly RecipeIngredientLike[];
  servings: number;
  cookedMassG?: number | null;
}): RecipeTotals {
  const { ingredients, servings } = input;
  if (!Number.isFinite(servings) || servings <= 0) {
    throw new RangeError(`servings must be positive, got ${servings}`);
  }

  const totalMassG = roundTo(
    ingredients.reduce((sum, i) => sum + i.massG, 0),
    4,
  );
  const total =
    ingredients.length === 0 ? zeroNutrients() : addNutrients(...ingredients.map((i) => i.nutrients));

  const cooked = input.cookedMassG;
  const usedCookedMass = cooked != null && Number.isFinite(cooked) && cooked > 0;
  const basisMassG = usedCookedMass ? cooked : totalMassG;

  return {
    totalMassG,
    total,
    nutrientsPerServing: multiplyNutrients(total, 1 / servings),
    nutrientsPer100g: basisMassG > 0 ? multiplyNutrients(total, 100 / basisMassG) : zeroNutrients(),
    basisMassG,
    usedCookedMass,
  };
}

/**
 * Scale a recipe to a different number of servings — batch cooking.
 * Returns the multiplier; the caller re-scales each ingredient through
 * `computePortionNutrition` so quantities and masses stay consistent.
 */
export function servingScaleFactor(fromServings: number, toServings: number): number {
  if (fromServings <= 0) throw new RangeError(`fromServings must be positive, got ${fromServings}`);
  return roundTo(toServings / fromServings, 6);
}
