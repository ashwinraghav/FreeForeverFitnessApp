import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { Select } from './Select.js';

const meta = {
  title: 'Primitives/Select',
  component: Select,
  args: { label: 'Units' },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

const options = (
  <>
    <option value="kg">Kilograms</option>
    <option value="lb">Pounds</option>
  </>
);

export const Playground: Story = { args: { children: options } };

export const BothThemes: Story = {
  render: () => (
    <ThemePair>
      <div style={{ width: '100%' }}>
        <Select label="Units">{options}</Select>
      </div>
      <div style={{ width: '100%' }}>
        <Select label="Units" error="Pick one">
          {options}
        </Select>
      </div>
    </ThemePair>
  ),
};
