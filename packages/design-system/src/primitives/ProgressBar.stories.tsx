import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { ProgressBar } from './ProgressBar.js';

const meta = {
  title: 'Primitives/ProgressBar',
  component: ProgressBar,
  args: { value: 0.6, label: 'Workout progress', valueText: 'Set 3 of 5' },
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const BothThemes: Story = {
  render: () => (
    <ThemePair>
      <div style={{ width: '100%' }}>
        <ProgressBar value={0} label="Not started" />
      </div>
      <div style={{ width: '100%' }}>
        <ProgressBar value={0.6} label="Workout progress" valueText="Set 3 of 5" />
      </div>
      <div style={{ width: '100%' }}>
        <ProgressBar value={1} label="Complete" />
      </div>
      <div style={{ width: '100%' }}>
        <ProgressBar label="Syncing" />
      </div>
    </ThemePair>
  ),
};
