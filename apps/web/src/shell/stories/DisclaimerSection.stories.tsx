import { DisclaimerSection } from '../DisclaimerSection.js';
import '../shell.css';

/**
 * The disclaimer, in the gallery.
 *
 * Typed structurally rather than against `@storybook/react`, for the reason
 * `BriefSection.stories.tsx` gives: `apps/web` carries no Storybook dependency and
 * adding one is app config. CSF3 is a plain-object format, so this file is a valid
 * entry either way.
 *
 * What is worth looking at here is the weight of the copy. This section has to be read
 * once and believed, without reading as a legal notice bolted onto a fitness app or as
 * a warning that makes the product look dangerous. Read it directly beneath the "How
 * this works" section in the MoreScreen story and ask whether the accent rule on the
 * last paragraph is doing too much or too little — it is the same treatment the
 * free-forever promise gets, which is either the right parallel or a collision.
 */
const meta = {
  title: 'Shell/DisclaimerSection',
  component: DisclaimerSection,
  parameters: { layout: 'padded' },
};

export default meta;

export const Default = {};
