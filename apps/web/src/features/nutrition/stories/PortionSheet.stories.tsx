import { useState } from 'react';
import { Button } from '@freeforever/design-system';
import { servingsForFood, type Serving } from '@freeforever/core/src/nutrition/index.js';
import { PortionSheet, type PortionSheetProps } from '../components/PortionSheet.js';
import type { FoodSnapshot } from '../data/types.js';
import type { Meta, StoryObj } from './csf.js';
import '../nutrition.css';

const SLICE: Serving = { name: 'slice', gramsPerServing: 28 };
const GRAM: Serving = { name: 'g', gramsPerServing: 1 };

/**
 * The user's own test case, and the reason this sheet was reworked: "How easy
 * is it to log one serving of Optimum Nutrition's Gold Standard Whey vanilla?"
 *
 * Built through `servingsForFood` from the two fields the index carries, rather
 * than hand-written, so the fixture cannot drift from what a rebuilt index will
 * actually hand the app. Open Food Facts states this serving as
 * `"1 scoop (31 g)"`; USDA states the same product as `"1 Scoop"`.
 */
const WHEY: FoodSnapshot = {
  key: 'off:748927024074',
  ref: {
    source: 'bundled',
    foodId: 'off:748927024074',
    name: 'Gold Standard 100% Whey, Vanilla Ice Cream',
    brand: 'Optimum Nutrition',
  },
  nutrientsPer100g: {
    energyKcal: 387, proteinG: 77.4, carbsG: 9.7, fatG: 3.2, sugarG: 3.2, sodiumMg: 419, saturatedFatG: 1.6,
  },
  servings: servingsForFood({
    statedServingGrams: 31,
    statedServingLabel: '1 scoop (31 g)',
    basis: 'g',
  }),
  attributionUrl: 'https://world.openfoodfacts.org/product/748927024074',
  flags: { servingEstimated: false, energyDerived: false, atwaterMismatch: false, highConfidence: true },
};

/** A USDA row as today's index ships them: nutrients, and no serving at all. */
const CHICKEN: FoodSnapshot = {
  key: 'core:171077',
  ref: { source: 'bundled', foodId: 'core:171077', name: 'Chicken, broilers or fryers, breast, meat only, raw' },
  nutrientsPer100g: { energyKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 },
  servings: servingsForFood({ basis: 'g' }),
  flags: { servingEstimated: false, energyDerived: true, atwaterMismatch: false, highConfidence: true },
};

/** A drink. Measured in millilitres, because that is what the carton says. */
const OAT_MILK: FoodSnapshot = {
  key: 'off:7394376616037',
  ref: { source: 'bundled', foodId: 'off:7394376616037', name: 'Oat Drink Barista', brand: 'Oatly' },
  nutrientsPer100g: { energyKcal: 59, proteinG: 1, carbsG: 6.7, fatG: 3, sugarG: 3.9, sodiumMg: 40 },
  servings: servingsForFood({
    statedServingGrams: 250,
    statedServingLabel: '1 glass (250 ml)',
    basis: 'ml',
    densityGPerMl: 1,
  }),
  densityGPerMl: 1,
  attributionUrl: 'https://world.openfoodfacts.org/product/7394376616037',
  flags: { servingEstimated: true, energyDerived: false, atwaterMismatch: false, highConfidence: true },
};

const BREAD: FoodSnapshot = {
  key: 'off:bread',
  ref: { source: 'bundled', foodId: 'off:bread', name: 'Wholemeal Seeded Bread', brand: 'Hovis' },
  nutrientsPer100g: {
    energyKcal: 258, proteinG: 10.4, carbsG: 38.2, fatG: 5.9, fiberG: 6.2, sugarG: 3.1, sodiumMg: 420, saturatedFatG: 1.1,
  },
  servings: [SLICE, GRAM],
  attributionUrl: 'https://world.openfoodfacts.org/product/5010026503116',
  flags: { servingEstimated: false, energyDerived: false, atwaterMismatch: false, highConfidence: true },
};

const OIL: FoodSnapshot = {
  key: 'core:oil',
  ref: { source: 'bundled', foodId: 'core:oil', name: 'Olive oil' },
  nutrientsPer100g: { energyKcal: 884, proteinG: 0, carbsG: 0, fatG: 100, saturatedFatG: 13.8 },
  servings: [
    { name: 'tbsp', gramsPerServing: 13.5, millilitresPerServing: 14.787 },
    GRAM,
    { name: 'ml', gramsPerServing: 0.913, millilitresPerServing: 1 },
  ],
  densityGPerMl: 0.913,
  flags: { servingEstimated: true, energyDerived: false, atwaterMismatch: false, highConfidence: true },
};

/**
 * Choose a portion and log it.
 *
 * A `Sheet`, never a `Dialog` — non-blocking, so nothing here can swallow what
 * the user already entered. Switching serving holds the *mass* constant, so "2
 * slices" becomes "56 g" rather than "2 g", and every quantity change
 * re-derives from the per-100 g profile so twelve taps of `+` land exactly
 * where typing 12 lands.
 */
const meta: Meta<PortionSheetProps> = { title: 'Nutrition/PortionSheet', component: PortionSheet };
export default meta;

function Demo({ snapshot, ...rest }: { snapshot: FoodSnapshot } & Partial<PortionSheetProps>) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button variant="secondary" size="lg" onClick={() => setOpen(true)}>
        Open the sheet
      </Button>
      <PortionSheet
        open={open}
        onClose={() => setOpen(false)}
        snapshot={snapshot}
        initialSlot="lunch"
        massUnit="g"
        energyUnit="kcal"
        onLog={() => setOpen(false)}
        onToggleFavourite={() => undefined}
        {...rest}
      />
    </>
  );
}

export const OneScoopOfWhey: StoryObj<PortionSheetProps> = {
  name: 'A branded food — opens on one serving, and says what one serving is',
  render: () => <Demo snapshot={WHEY} />,
};

export const NoServingSize: StoryObj<PortionSheetProps> = {
  name: 'A food with no serving — falls back to 100 g and refuses to call it one serving',
  render: () => <Demo snapshot={CHICKEN} />,
};

export const ADrink: StoryObj<PortionSheetProps> = {
  name: 'A drink — millilitres, not grams',
  render: () => <Demo snapshot={OAT_MILK} />,
};

export const StatedServing: StoryObj<PortionSheetProps> = {
  name: 'A food with its own serving — opens on the number from the packet',
  render: () => <Demo snapshot={BREAD} initialQuantity={2} initialServing={SLICE} />,
};

export const Favourited: StoryObj<PortionSheetProps> = {
  render: () => <Demo snapshot={BREAD} isFavourite initialQuantity={2} initialServing={SLICE} />,
};

export const LiquidWithDensity: StoryObj<PortionSheetProps> = {
  name: 'A liquid — volume converts to mass by density, not one-for-one',
  render: () => <Demo snapshot={OIL} initialQuantity={1} />,
};

export const EditingAnExistingEntry: StoryObj<PortionSheetProps> = {
  render: () => <Demo snapshot={BREAD} initialQuantity={4} initialServing={SLICE} submitLabel="Save changes" />,
};
