import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { Avatar } from './Avatar.js';

const meta: Meta<typeof Avatar> = {
  title: 'Primitives/Avatar',
  component: Avatar,
  args: { name: 'Ada Lovelace', size: 'md' },
};

export default meta;
type Story = StoryObj<typeof Avatar>;

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
