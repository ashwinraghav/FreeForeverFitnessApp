import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { ThemePair } from '../lib/ThemePair.js';
import { NumberField } from './NumberField.js';

const meta: Meta<typeof NumberField> = {
  title: 'Primitives/NumberField',
  component: NumberField,
};

export default meta;
type Story = StoryObj<typeof NumberField>;

/** The field is controlled, so a live story has to own the value. */
function Controlled({ ghost = null }: { ghost?: number | null }) {
  const [value, setValue] = useState<number | null>(null);
  return (
    <NumberField
      label="Weight"
      unit="kg"
      step={2.5}
      min={0}
      value={value}
      ghostValue={ghost}
      onValueChange={setValue}
    />
  );
}

export const Playground: Story = {
  render: () => <Controlled ghost={60} />,
};

export const GhostVersusEntered: Story = {
  name: 'Ghost vs entered (the distinction survives greyscale)',
  render: () => (
    <ThemePair>
      <div style={{ width: '100%' }}>
        <NumberField
          label="Weight (carried over)"
          unit="kg"
          value={null}
          ghostValue={60}
          onValueChange={() => {}}
        />
      </div>
      <div style={{ width: '100%' }}>
        <NumberField label="Weight (entered)" unit="kg" value={62.5} onValueChange={() => {}} />
      </div>
    </ThemePair>
  ),
};

export const WithError: Story = {
  render: () => (
    <ThemePair>
      <div style={{ width: '100%' }}>
        <NumberField
          label="Reps"
          value={null}
          error="Enter how many reps you completed"
          onValueChange={() => {}}
        />
      </div>
    </ThemePair>
  ),
};
