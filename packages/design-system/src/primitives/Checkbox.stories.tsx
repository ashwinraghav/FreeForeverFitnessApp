import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { Checkbox } from './Checkbox.js';

const meta = {
  title: 'Primitives/Checkbox',
  component: Checkbox,
  args: { children: 'Warm-up set' },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const BothThemes: Story = {
  render: () => (
    <ThemePair>
      <Checkbox>Unchecked</Checkbox>
      <Checkbox defaultChecked>Checked</Checkbox>
      <Checkbox indeterminate>Mixed</Checkbox>
      <Checkbox disabled>Disabled</Checkbox>
    </ThemePair>
  ),
};
