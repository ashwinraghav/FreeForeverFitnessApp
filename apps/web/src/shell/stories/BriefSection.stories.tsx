import { MemoryRouter } from 'react-router-dom';
import { BriefSection } from '../BriefSection.js';
import '../shell.css';

/**
 * The handoff, in the gallery.
 *
 * Typed structurally rather than against `@storybook/react`, for the same reason
 * `features/nutrition/stories/csf.ts` gives: `apps/web` carries no Storybook
 * dependency, and adding one is app config. CSF3 is a plain-object format, so this
 * file is a valid entry either way — the root `.storybook/main.ts` already globs
 * `apps/web/src/**`.
 *
 * What is worth looking at here is the copy, not the layout. This is the only screen
 * in the app that offers to send a lifter's training to a company that is not us, and
 * the consent has to read as a plain statement of what happens rather than as a
 * feature being sold. Read it next to the design system's Button stories and ask
 * whether the primary action looks more eager than the sentence above it.
 *
 * Pressing the button in the gallery does the real thing: it folds whatever is in this
 * browser's `localStorage` and opens the share sheet. On an empty profile that is a
 * two-line brief, which is itself the state worth seeing.
 */
const meta = {
  title: 'Shell/BriefSection',
  component: BriefSection,
  parameters: {
    // Sits inside More, which is a normal scrolling page rather than a session screen.
    layout: 'padded',
  },
};

export default meta;

interface Story {
  name?: string;
  render?: () => React.ReactElement;
}

export const InMore: Story = {
  name: 'As it appears in More',
  render: () => (
    <MemoryRouter>
      <div className="ff-more">
        <BriefSection />
      </div>
    </MemoryRouter>
  ),
};
