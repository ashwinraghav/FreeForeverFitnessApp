import { FoodFlags } from '../components/FoodFlags.js';
import type { FoodSnapshot } from '../data/types.js';
import type { Meta, StoryObj } from './csf.js';
import '../nutrition.css';

type Props = Parameters<typeof FoodFlags>[0];

function snapshot(over: Partial<FoodSnapshot>): FoodSnapshot {
  return {
    key: 'off:1',
    ref: { source: 'bundled', foodId: 'off:1', name: 'A food' },
    nutrientsPer100g: { energyKcal: 200, proteinG: 5, carbsG: 30, fatG: 6 },
    servings: [{ name: 'g', gramsPerServing: 1 }],
    ...over,
  };
}

/**
 * Data-quality caveats and the licence attribution.
 *
 * `energyDerived` fires on about a quarter of USDA records — the energy was
 * computed from the macros because upstream stated none — and someone comparing
 * two foods deserves to know which figure was measured and which was inferred.
 *
 * The Open Food Facts link is a licence obligation, not a nicety: ODbL requires
 * a link to the product page reachable from the food's detail view. Removing it
 * puts the project in breach (`packages/datasets/NOTICE.md` §2.2).
 */
const meta: Meta<Props> = { title: 'Nutrition/FoodFlags', component: FoodFlags };
export default meta;

export const Clean: StoryObj<Props> = {
  name: 'Nothing to say — renders nothing',
  args: { snapshot: snapshot({}) },
};

export const EnergyEstimated: StoryObj<Props> = {
  args: {
    snapshot: snapshot({
      flags: { energyDerived: true, servingEstimated: false, atwaterMismatch: false, highConfidence: false },
    }),
  },
};

export const EveryCaveat: StoryObj<Props> = {
  args: {
    snapshot: snapshot({
      flags: { energyDerived: true, servingEstimated: true, atwaterMismatch: true, highConfidence: false },
    }),
  },
};

export const OpenFoodFactsAttribution: StoryObj<Props> = {
  name: 'ODbL attribution — a licence obligation, must stay reachable',
  args: {
    snapshot: snapshot({
      attributionUrl: 'https://world.openfoodfacts.org/product/3017620422003',
      flags: { energyDerived: false, servingEstimated: true, atwaterMismatch: false, highConfidence: true },
    }),
  },
};
