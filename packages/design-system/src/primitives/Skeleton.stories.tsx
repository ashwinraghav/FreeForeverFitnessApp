import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { Skeleton } from './Skeleton.js';

const meta = {
  title: 'Primitives/Skeleton',
  component: Skeleton,
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = { args: { width: '12rem', height: 'var(--ff-space-16)' } };

export const LoadingRow: Story = {
  name: 'Loading row (sweep is removed entirely under prefers-reduced-motion)',
  render: () => (
    <ThemePair>
      <div
        aria-busy="true"
        aria-label="Loading workout"
        style={{ display: 'flex', gap: 'var(--ff-space-12)', alignItems: 'center', width: '100%' }}
      >
        <Skeleton circle width="var(--ff-space-40)" height="var(--ff-space-40)" />
        <div style={{ flex: 1, display: 'grid', gap: 'var(--ff-space-8)' }}>
          <Skeleton width="60%" />
          <Skeleton width="35%" />
        </div>
      </div>
    </ThemePair>
  ),
};
