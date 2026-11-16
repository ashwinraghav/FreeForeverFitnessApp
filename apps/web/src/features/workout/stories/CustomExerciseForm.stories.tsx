import {
  CustomExerciseForm,
  type CustomExerciseFormProps,
} from '../components/CustomExerciseForm.js';
import type { Meta, StoryObj } from './csf.js';
import '../workout.css';

/**
 * Writing down a movement the catalogue does not have.
 *
 * What is worth looking at here is the *weight* of the thing. This panel appears at the
 * moment a lifter has been told the app does not know their exercise, standing between
 * sets. Every control is a reason to give up, so the question to ask of the gallery is
 * not whether it looks tidy — it is whether it still looks like four quick answers at
 * 200% text, where the three selects and the two buttons stack and the panel gets tall.
 *
 * Saving here writes to this browser's `localStorage` for real, exactly as the app does.
 * Clear site data for the Storybook origin to reset it.
 *
 * Two things the gallery cannot show, both noted because a green story is not a working
 * screen: this renders inside the picker's Sheet in the app, so its real width is the
 * Sheet's and not the viewport's; and jsdom tests beside it assert behaviour while
 * measuring nothing, which is why `ffw-custom` sets no width or height at all.
 */
const meta: Meta<CustomExerciseFormProps> = {
  title: 'Workout/CustomExerciseForm',
  component: CustomExerciseForm,
  parameters: { layout: 'centered' },
  args: {
    initialName: 'Jefferson Curl',
    onCreated: () => undefined,
    onCancel: () => undefined,
  },
};

export default meta;

/** The ordinary case: they typed a name, the search found nothing, this opened. */
export const Prefilled: StoryObj<CustomExerciseFormProps> = {};

/**
 * Opened with nothing typed.
 *
 * Reachable only if a caller offers the form without a query — the picker deliberately
 * does not. Worth keeping in the gallery because it is the state where the submit button
 * must refuse rather than save a nameless exercise.
 */
export const Empty: StoryObj<CustomExerciseFormProps> = {
  args: { initialName: '' },
};

/**
 * A name at the storage limit.
 *
 * `MAX_NAME_LENGTH` is 80 and the field enforces it, so this is what the longest legal
 * name does to the layout. If it pushes the panel sideways at any width, that is the bug
 * this story exists to catch — and the one no test in this repo can.
 */
export const LongName: StoryObj<CustomExerciseFormProps> = {
  args: { initialName: 'Single Arm Half Kneeling Landmine Press With A Pause At The Bottom' },
};
