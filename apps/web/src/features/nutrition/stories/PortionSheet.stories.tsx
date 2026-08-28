import { useState } from 'react';
import { Button } from '@freeforever/design-system';
import type { Serving } from '@freeforever/core/src/nutrition/index.js';
import { PortionSheet, type PortionSheetProps } from '../components/PortionSheet.js';
import type { FoodSnapshot } from '../data/types.js';
import type { Meta, StoryObj } from './csf.js';
import '../nutrition.css';

const SLICE: Serving = { name: '1 slice', gramsPerServing: 28 };
const GRAM: Serving = { name: 'g', gramsPerServing: 1 };
const HUNDRED: Serving = { name: '100 g', gramsPerServing: 100 };

const BREAD: FoodSnapshot = {
  key: 'off:bread',
  ref: { source: 'bundled', foodId: 'off:bread', name: 'Wholemeal Seeded Bread', brand: 'Hovis' },
  nutrientsPer100g: {
    energyKcal: 258, proteinG: 10.4, carbsG: 38.2, fatG: 5.9, fiberG: 6.2, sugarG: 3.1, sodiumMg: 420, saturatedFatG: 1.1,
  },
  servings: [SLICE, GRAM, HUNDRED],
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
