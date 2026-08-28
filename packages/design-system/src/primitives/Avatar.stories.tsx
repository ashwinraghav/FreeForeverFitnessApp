import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { Avatar } from './Avatar.js';

const meta = {
  title: 'Primitives/Avatar',
  component: Avatar,
  args: { name: 'Ada Lovelace', size: 'md' },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sizes: Story = {
  render: () => (
    <ThemePair>
      <div style={{ display: 'flex', gap: 'var(--ff-space-12)', alignItems: 'center' }}>
        <Avatar name="Ada Lovelace" size="sm" />
        <Avatar name="Ada Lovelace" size="md" />
        <Avatar name="Ada Lovelace" size="lg" />
      </div>
    </ThemePair>
  ),
};
