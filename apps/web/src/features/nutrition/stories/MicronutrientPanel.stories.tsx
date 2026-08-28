import { MicronutrientPanel } from '../components/MicronutrientPanel.js';
import type { Meta, StoryObj } from './csf.js';
import '../nutrition.css';

type Props = Parameters<typeof MicronutrientPanel>[0];

/**
 * Free, because it costs nothing.
 *
 * The numbers are already in the day document; showing them is a render, not a
 * query. It is paywalled elsewhere for the same reason per-day targets are —
 * it is something people will pay for, not something expensive to provide
 * (ADR-0001 rule 6).
 *
 * A nutrient nothing in the day carried is omitted rather than shown as zero.
 * "Iron 0 mg" is a measurement claim; the absence of the row is the truth.
 */
const meta: Meta<Props> = {
  title: 'Nutrition/MicronutrientPanel',
  component: MicronutrientPanel,
  args: { massUnit: 'g', includesBundledFoods: false },
};
export default meta;

export const UserAuthoredFoodsOnly: StoryObj<Props> = {
  name: 'User-authored foods — absent nutrients are genuinely absent',
  args: {
    nutrients: {
      energyKcal: 1980,
      proteinG: 142,
      carbsG: 190,
      fatG: 63,
      fiberG: 28,
      sugarG: 44,
      saturatedFatG: 18,
      sodiumMg: 2310,
    },
  },
};

export const IncludingBundledFoods: StoryObj<Props> = {
  name: 'With bundled foods — carries the caveat about zeros',
  args: {
    includesBundledFoods: true,
    nutrients: {
      energyKcal: 1980,
      proteinG: 142,
      carbsG: 190,
      fatG: 63,
      fiberG: 28,
      sugarG: 44,
      saturatedFatG: 18,
      sodiumMg: 2310,
      potassiumMg: 3100,
      calciumMg: 780,
      ironMg: 14.2,
    },
  },
};

export const NothingRecorded: StoryObj<Props> = {
  name: 'A day whose foods carried no micronutrient figures at all',
  args: { nutrients: { energyKcal: 600, proteinG: 20, carbsG: 70, fatG: 25 } },
};
