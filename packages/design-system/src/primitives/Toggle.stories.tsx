import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { Toggle } from './Toggle.js';

const meta: Meta<typeof Toggle> = {
  title: 'Primitives/Toggle',
  component: Toggle,
  args: { children: 'Rest timer' },
};

export default meta;
type Story = StoryObj<typeof Toggle>;

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
