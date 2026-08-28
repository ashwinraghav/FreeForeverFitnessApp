import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { ThemePair } from '../lib/ThemePair.js';
import { SegmentedControl } from './SegmentedControl.js';

const meta: Meta<typeof SegmentedControl> = {
  title: 'Primitives/SegmentedControl',
  component: SegmentedControl,
};

export default meta;
type Story = StoryObj<typeof SegmentedControl>;

function Demo() {
  const [value, setValue] = useState('kg');
  return (
    <SegmentedControl
      label="Units"
      value={value}
      onValueChange={setValue}
      options={[
        { value: 'kg', label: 'kg' },
        { value: 'lb', label: 'lb' },
      ]}
    />
  );
}

export const Playground: Story = { render: () => <Demo /> };

export const BothThemes: Story = {
  render: () => (
    <ThemePair>
      <Demo />
    </ThemePair>
  ),
};
