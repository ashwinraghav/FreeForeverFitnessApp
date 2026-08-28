import type { Serving } from '@freeforever/core/src/nutrition/index.js';
import { RepeatStrip } from '../components/RepeatStrip.js';
import type { RecentFood } from '../data/types.js';
import type { Meta, StoryObj } from './csf.js';
import '../nutrition.css';

type Props = Parameters<typeof RepeatStrip>[0];

const SLICE: Serving = { name: 'slice', gramsPerServing: 28 };
const GRAM: Serving = { name: 'g', gramsPerServing: 1 };

function recent(
  key: string,
  name: string,
  per100: { energyKcal: number; proteinG: number; carbsG: number; fatG: number },
  over: Partial<RecentFood> = {},
): RecentFood {
  return {
    snapshot: {
      key,
      ref: { source: 'bundled', foodId: key, name },
      nutrientsPer100g: per100,
      servings: [GRAM, SLICE],
    },
    lastQuantity: 100,
    lastServing: GRAM,
    lastSlot: 'lunch',
    logCount: 4,
    lastLoggedAt: Date.now(),
    ...over,
  };
}

/**
 * The two-tap bar, made visible.
 *
 * Each button is a whole logging action: the food, the portion the user chose
 * last time, and the meal it goes to. It is deliberately not behind a "+", a
 * menu or a sheet — every layer of disclosure is a tap, and taps are the thing
 * being spent. The accessible name carries the entire action because the
 * visible label is clamped to two lines.
 */
const meta: Meta<Props> = {
  title: 'Nutrition/RepeatStrip',
  component: RepeatStrip,
  args: {
    energyUnit: 'kcal',
    onLogAgain: () => undefined,
    onOpenPortion: () => undefined,
    recents: [
      recent('core:1', 'Oats, rolled', { energyKcal: 389, proteinG: 16.9, carbsG: 66.3, fatG: 6.9 }, {
        lastQuantity: 80,
        lastSlot: 'breakfast',
        logCount: 42,
      }),
      recent('core:2', 'Chicken breast, raw', { energyKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 }, {
        lastQuantity: 180,
      }),
      recent('off:3', 'Greek Style Natural Yogurt', { energyKcal: 133, proteinG: 5.7, carbsG: 4.9, fatG: 10.2 }, {
        lastQuantity: 170,
        lastSlot: 'snack',
      }),
      recent('core:4', 'Rice, white, cooked', { energyKcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 }, {
        lastQuantity: 250,
        lastSlot: 'dinner',
      }),
    ],
  },
};
export default meta;

export const Playground: StoryObj<Props> = {};

export const OneShortcut: StoryObj<Props> = {
  name: 'A single shortcut (a new user, one food in)',
  args: {
    recents: [
      recent('core:1', 'Oats, rolled', { energyKcal: 389, proteinG: 16.9, carbsG: 66.3, fatG: 6.9 }, {
        lastQuantity: 80,
        lastSlot: 'breakfast',
      }),
    ],
  },
};

export const LongBrandedNames: StoryObj<Props> = {
  name: 'Long branded names — clamped to two lines, full text in the label',
  args: {
    recents: [
      recent(
        'off:9',
        'The Madelaine Chocolate Company, Solid Milk Chocolate Foiled Hearts',
        { energyKcal: 545, proteinG: 7.1, carbsG: 59, fatG: 31 },
        { lastQuantity: 40, lastSlot: 'snack' },
      ),
      recent(
        'off:10',
        'Organic Unsweetened Vanilla Almond Milk Beverage, Refrigerated',
        { energyKcal: 13, proteinG: 0.4, carbsG: 0.4, fatG: 1.1 },
        { lastQuantity: 240, lastSlot: 'breakfast' },
      ),
    ],
  },
};

export const Empty: StoryObj<Props> = {
  name: 'No history — renders nothing rather than an empty rail',
  args: { recents: [] },
};
