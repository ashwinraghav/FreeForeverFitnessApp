import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { Checkbox } from './Checkbox.js';

const meta: Meta<typeof Checkbox> = {
  title: 'Primitives/Checkbox',
  component: Checkbox,
  args: { children: 'Warm-up set' },
};

export default meta;
type Story = StoryObj<typeof Checkbox>;

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
