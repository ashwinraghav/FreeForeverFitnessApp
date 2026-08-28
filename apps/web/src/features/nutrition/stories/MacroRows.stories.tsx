import { summariseDay } from '@freeforever/core/src/nutrition/index.js';
import { MacroRows } from '../components/MacroRows.js';
import type { Meta, StoryObj } from './csf.js';
import '../nutrition.css';

type Props = Parameters<typeof MacroRows>[0];

const TARGET = { energyKcal: 2210, proteinG: 160, carbsG: 220, fatG: 69, fiberG: 31, waterMl: 2600 };

/**
 * `Meter`, not `ProgressBar` — a measurement inside a range, not progress
 * through a task. Screen readers announce them differently and the wrong one is
 * a real bug, not a preference.
 */
const meta: Meta<Props> = {
  title: 'Nutrition/MacroRows',
  component: MacroRows,
  args: {
    massUnit: 'g',
    summary: summariseDay({
      totals: { energyKcal: 1450, proteinG: 96, carbsG: 150, fatG: 48, fiberG: 18 },
      target: TARGET,
      waterMl: 1500,
    }),
  },
};
export default meta;

export const PartWayThroughTheDay: StoryObj<Props> = {};

export const ProteinOverTarget: StoryObj<Props> = {
  name: 'One macro over — the row says how far, in words',
  args: {
    summary: summariseDay({
      totals: { energyKcal: 2300, proteinG: 198, carbsG: 210, fatG: 70, fiberG: 33 },
      target: TARGET,
      waterMl: 2600,
    }),
  },
};

export const NoFibreOrWaterTarget: StoryObj<Props> = {
  name: 'Target sets no fibre or water — the rows are omitted, not zeroed',
  args: {
    summary: summariseDay({
      totals: { energyKcal: 1450, proteinG: 96, carbsG: 150, fatG: 48 },
      target: { energyKcal: 2210, proteinG: 160, carbsG: 220, fatG: 69 },
      waterMl: 0,
    }),
  },
};

export const Imperial: StoryObj<Props> = { args: { massUnit: 'oz' } };
