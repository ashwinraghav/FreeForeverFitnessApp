import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { Toggle } from './Toggle.js';

const meta = {
  title: 'Primitives/Toggle',
  component: Toggle,
  args: { children: 'Rest timer' },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const BothThemes: Story = {
  name: 'Both themes (state is knob position, not colour)',
  render: () => (
    <ThemePair>
      <Toggle>Off</Toggle>
      <Toggle defaultChecked>On</Toggle>
      <Toggle disabled>Disabled</Toggle>
    </ThemePair>
  ),
};
