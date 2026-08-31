import {
  servingsForFood,
  toCanonicalPer100g,
  type NutrientProfile,
  type Serving,
} from '@freeforever/core/src/nutrition/index.js';
import type { Food } from '@freeforever/datasets';
import type { CustomFood, FoodSnapshot, Recipe } from './types.js';

/**
 * Turning an index row, a custom food or a recipe into the one shape the
 * logging surfaces understand.
 *
 * The index's `Nutrients` and the domain's `NutrientProfile` are different
 * types with different field names and, for volumetric rows, a different basis.
 * Doing that translation at every call site is how `carbG` ends up in a
 * `carbsG` field and a whole macro silently reads zero, so it happens exactly
 * here.
 */

/**
 * The index has no way to say "no figure": a missing fibre value is encoded as
 * a zero, and the reader cannot distinguish the two.
 *
 * That is a property of the binary format, not something to paper over at this
 * boundary — inventing an `undefined` from a zero would hide real zeros
 * (a diet soda genuinely has no sugar). Bundled foods therefore always report a
 * figure; the absent-versus-zero distinction that `addNutrients` preserves is
 * only meaningful for user-authored foods and recipes, which is documented on
 * the micronutrient panel.
 */
export function profileFromIndex(food: Food): NutrientProfile {
  const per100: NutrientProfile = {
    energyKcal: food.per100.kcal,
    proteinG: food.per100.proteinG,
    carbsG: food.per100.carbG,
    fatG: food.per100.fatG,
    fiberG: food.per100.fibreG,
    sugarG: food.per100.sugarG,
    sodiumMg: food.per100.sodiumMg,
    saturatedFatG: food.per100.satFatG,
  };
  // A volumetric row states its nutrients per 100 ml. The domain stores per
  // 100 g, always. The index carries no density, so this is the pipeline's own
  // 1.0 g/ml assumption — the identity, but written down rather than implied.
  return toCanonicalPer100g(per100, food.basis, ASSUMED_INDEX_DENSITY_G_PER_ML);
}

/**
 * The index does not ship densities, so a volumetric row is converted at 1.0
 * g/ml — the same assumption the build pipeline makes when it derives a serving
 * mass from a volume. Kept as a named constant so the assumption is greppable
 * rather than a bare `1` in a conversion.
 */
export const ASSUMED_INDEX_DENSITY_G_PER_ML = 1.0;

export function snapshotFromIndexFood(
  food: Food,
  opts: {
    imperial?: boolean;
    /**
     * The GTIN the user actually scanned, when it differs from the record's own.
     *
     * Several barcodes can resolve to one `Food`: the index merges near-
     * duplicate regional SKUs and keeps the losers' barcodes pointing at the
     * survivor (`alsoBarcodes`), so `byBarcode(x).barcode` is not necessarily
     * `x`. Storing the survivor's primary would mean a user who saved their own
     * corrections against this packet would not be found by re-scanning it —
     * `ScanScreen` matches their custom foods on the scanned number.
     *
     * `resolveBarcode` already separates `matchedBarcode` from the food it
     * found, for the GTIN-12-versus-13 case; this is the same distinction one
     * layer up.
     */
    scannedBarcode?: string;
  } = {},
): FoodSnapshot {
  const isLiquid = food.basis === 'ml';
  const barcode = opts.scannedBarcode ?? food.barcode;
  return {
    key: food.id,
    ref: {
      source: 'bundled',
      foodId: food.id,
      name: food.name,
      ...(food.brand !== null ? { brand: food.brand } : {}),
    },
    nutrientsPer100g: profileFromIndex(food),
    servings: servingsForFood({
      statedServingGrams: food.servingGrams,
      statedServingLabel: food.servingLabel,
      basis: food.basis,
      densityGPerMl: isLiquid ? ASSUMED_INDEX_DENSITY_G_PER_ML : null,
      ...(opts.imperial === true ? { imperial: true } : {}),
    }),
    ...(isLiquid ? { densityGPerMl: ASSUMED_INDEX_DENSITY_G_PER_ML } : {}),
    ...(barcode !== null ? { barcode } : {}),
    // Rendering this for an Open Food Facts row is a licence obligation, not a
    // nicety (packages/datasets/NOTICE.md §2.2).
    ...(food.attributionUrl !== null ? { attributionUrl: food.attributionUrl } : {}),
    flags: {
      servingEstimated: food.flags.servingEstimated,
      energyDerived: food.flags.energyDerived,
      atwaterMismatch: food.flags.atwaterMismatch,
      highConfidence: food.flags.highConfidence,
    },
  };
}

export function snapshotFromCustomFood(
  food: CustomFood,
  opts: { imperial?: boolean } = {},
): FoodSnapshot {
  const servings =
    food.servings.length > 0
      ? food.servings
      : servingsForFood({
          basis: food.densityGPerMl != null ? 'ml' : 'g',
          densityGPerMl: food.densityGPerMl ?? null,
          ...(opts.imperial === true ? { imperial: true } : {}),
        });
  return {
    key: customFoodKey(food.id),
    ref: {
      source: food.source,
      foodId: food.id,
      name: food.name,
      ...(food.brand !== undefined ? { brand: food.brand } : {}),
    },
    nutrientsPer100g: food.nutrientsPer100g,
    servings,
    ...(food.densityGPerMl !== undefined ? { densityGPerMl: food.densityGPerMl } : {}),
    ...(food.barcode !== undefined ? { barcode: food.barcode } : {}),
  };
}

/**
 * A recipe logs as a single food. Its default serving is one portion of the
 * recipe, which is the unit a person actually eats — not 100 g of casserole.
 */
export function snapshotFromRecipe(recipe: Recipe): FoodSnapshot {
  const gramsPerServing =
    recipe.servings > 0 ? recipe.totalMassG / recipe.servings : recipe.totalMassG;
  const basis = recipe.cookedMassG ?? recipe.totalMassG;
  const perServingMass = recipe.servings > 0 ? basis / recipe.servings : basis;

  const servings: Serving[] = [
    { name: 'serving', gramsPerServing: Math.max(0.01, perServingMass) },
    { name: 'g', gramsPerServing: 1 },
  ];

  return {
    key: recipeKey(recipe.id),
    ref: { source: 'recipe', foodId: recipe.id, name: recipe.name },
    nutrientsPer100g: recipe.nutrientsPer100g,
    servings: gramsPerServing > 0 ? servings : servings.slice(1),
  };
}

export function customFoodKey(id: string): string {
  return `custom:${id}`;
}

export function recipeKey(id: string): string {
  return `recipe:${id}`;
}

/** Which namespace a stored key belongs to, without a lookup. */
export function keyKind(key: string): 'custom' | 'recipe' | 'bundled' {
  if (key.startsWith('custom:')) return 'custom';
  if (key.startsWith('recipe:')) return 'recipe';
  return 'bundled';
}
