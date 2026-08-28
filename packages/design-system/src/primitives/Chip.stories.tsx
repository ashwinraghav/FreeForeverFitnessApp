import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { ThemePair } from '../lib/ThemePair.js';
import { Chip } from './Chip.js';

const meta = {
  title: 'Primitives/Chip',
  component: Chip,
  args: { children: 'Push' },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

function Filters() {
  const [selected, setSelected] = useState('Push');
  return (
    <div style={{ display: 'flex', gap: 'var(--ff-space-8)', flexWrap: 'wrap' }}>
      {['Push', 'Pull', 'Legs'].map((name) => (
        <Chip key={name} selected={selected === name} onClick={() => setSelected(name)}>
          {name}
        </Chip>
      ))}
    </div>
  );
}

export const BothThemes: Story = {
  render: () => (
    <ThemePair>
      <Filters />
    </ThemePair>
  ),
};
