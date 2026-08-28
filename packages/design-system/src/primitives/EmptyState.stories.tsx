import type { Meta, StoryObj } from '@storybook/react';

import { PlusGlyph } from '../lib/glyphs.js';
import { ThemePair } from '../lib/ThemePair.js';
import { Button } from './Button.js';
import { EmptyState } from './EmptyState.js';

const meta: Meta<typeof EmptyState> = {
  title: 'Primitives/EmptyState',
  component: EmptyState,
  args: {
    title: 'No workouts yet',
    body: 'Start one and it will show up here, along with everything you lift.',
  },
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Playground: Story = {};

export const BothThemes: Story = {
  name: 'Both themes (one action, not three)',
  render: () => (
    <ThemePair>
      <div style={{ width: '100%' }}>
        <EmptyState
          glyph={<PlusGlyph />}
          title="No workouts yet"
          body="Start one and it will show up here, along with everything you lift."
          action={
            <Button variant="primary" size="xl">
              Start a workout
            </Button>
          }
        />
      </div>
    </ThemePair>
  ),
};
