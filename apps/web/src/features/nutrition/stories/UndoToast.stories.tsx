import { UndoToast } from '../components/UndoToast.js';
import type { Meta, StoryObj } from './csf.js';
import '../nutrition.css';

type Props = Parameters<typeof UndoToast>[0];

/**
 * Confirmation with an undo.
 *
 * One-tap logging is only safe because this exists. The write happens
 * immediately — no confirmation step, because the confirmation step is the tap
 * the feature is trying not to spend — and undo is what makes a mis-tap cost
 * nothing. Take it away and one-tap logging becomes a trap.
 */
const meta: Meta<Props> = { title: 'Nutrition/UndoToast', component: UndoToast };
export default meta;

export const AfterLogging: StoryObj<Props> = {
  args: {
    action: {
      id: '1',
      message: 'Chicken breast, raw · 6 × slice · 277 kcal',
      undo: () => undefined,
    },
    onDismiss: () => undefined,
  },
};

export const LongFoodName: StoryObj<Props> = {
  args: {
    action: {
      id: '2',
      message: 'The Madelaine Chocolate Company, Solid Milk Chocolate · 40 g · 218 kcal',
      undo: () => undefined,
    },
    onDismiss: () => undefined,
  },
};

export const Nothing: StoryObj<Props> = {
  name: 'No pending action — renders nothing',
  args: { action: null, onDismiss: () => undefined },
};
