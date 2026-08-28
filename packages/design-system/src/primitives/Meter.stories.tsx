import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { Meter } from './Meter.js';

const meta: Meta<typeof Meter> = {
  title: 'Primitives/Meter',
  component: Meter,
  args: { value: 96, max: 160, low: 60, optimum: 140, label: 'Protein', unit: 'g', showScale: true },
};

export default meta;
type Story = StoryObj<typeof Meter>;

export const Playground: Story = {};

export const Bands: Story = {
  name: 'Bands (the value is announced in words, not only shown in colour)',
  render: () => (
    <ThemePair>
      <div style={{ width: '100%' }}>
        <Meter value={30} max={160} low={60} optimum={140} label="Protein, low" unit="g" showScale />
      </div>
      <div style={{ width: '100%' }}>
        <Meter value={96} max={160} low={60} optimum={140} label="Protein, on track" unit="g" showScale />
      </div>
      <div style={{ width: '100%' }}>
        <Meter value={150} max={160} low={60} optimum={140} label="Protein, target met" unit="g" showScale />
      </div>
    </ThemePair>
  ),
};
