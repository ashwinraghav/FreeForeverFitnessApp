import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { Divider } from './Divider.js';

const meta: Meta<typeof Divider> = {
  title: 'Primitives/Divider',
  component: Divider,
};

export default meta;
type Story = StoryObj<typeof Divider>;

export const Playground: Story = {};

export const BothThemes: Story = {
  render: () => (
    <ThemePair>
      <div style={{ width: '100%' }}>
        <Divider />
        <Divider>Yesterday</Divider>
      </div>
    </ThemePair>
  ),
};
