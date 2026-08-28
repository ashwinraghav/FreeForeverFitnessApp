import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { Radio } from './Radio.js';

const meta = {
  title: 'Primitives/Radio',
  component: Radio,
  args: { children: 'Kilograms', name: 'units' },
} satisfies Meta<typeof Radio>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const BothThemes: Story = {
  render: () => (
    <ThemePair>
      <Radio name="units-story" value="kg" defaultChecked>
        Kilograms
      </Radio>
      <Radio name="units-story" value="lb">
        Pounds
      </Radio>
      <Radio name="units-story" value="stone" disabled>
        Stone
      </Radio>
    </ThemePair>
  ),
};
