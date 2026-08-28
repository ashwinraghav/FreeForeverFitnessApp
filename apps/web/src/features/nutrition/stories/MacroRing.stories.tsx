import { macroProgress } from '@freeforever/core/src/nutrition/index.js';
import { MacroRing, type MacroRingProps } from '../components/MacroRing.js';
import type { Meta, StoryObj } from './csf.js';
import '../nutrition.css';

/**
 * The one number read at arm's length.
 *
 * The states worth looking at side by side are the ones where colour alone
 * would not carry the meaning: over target, and a safety floor sitting close
 * to the target. Both have to survive greyscale and a sun-washed screen
 * (ADR-0013), which is why the overshoot is a separate outer arc and the label
 * says "over target" in words.
 */
const meta: Meta<MacroRingProps> = {
  title: 'Nutrition/MacroRing',
  component: MacroRing,
  args: { energy: macroProgress(1450, 2210), energyUnit: 'kcal' },
};
export default meta;

export const UnderTarget: StoryObj<MacroRingProps> = {};

export const JustStarted: StoryObj<MacroRingProps> = {
  name: 'Just started (nothing logged)',
  args: { energy: macroProgress(0, 2210) },
};

export const OnTarget: StoryObj<MacroRingProps> = {
  args: { energy: macroProgress(2210, 2210) },
};

export const OverTarget: StoryObj<MacroRingProps> = {
  name: 'Over target — an outer arc and the word "over", never colour alone',
  args: { energy: macroProgress(2680, 2210) },
};

export const WayOver: StoryObj<MacroRingProps> = {
  name: 'Far over (the fill clamps, the overshoot does not wrap)',
  args: { energy: macroProgress(4400, 2210) },
};

export const WithSafetyFloor: StoryObj<MacroRingProps> = {
  name: 'With the safety floor marked on the track',
  args: { energy: macroProgress(1450, 2210), floorKcal: 1780 },
};

export const NoTargetSet: StoryObj<MacroRingProps> = {
  name: 'No target set — logging still works, nothing is judged',
  args: { energy: macroProgress(1450, 0) },
};

export const Kilojoules: StoryObj<MacroRingProps> = {
  args: { energy: macroProgress(1450, 2210), energyUnit: 'kJ' },
};
