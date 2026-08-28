import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { TextField } from './TextField.js';

const meta: Meta<typeof TextField> = {
  title: 'Primitives/TextField',
  component: TextField,
  args: { label: 'Workout name', placeholder: 'Push day' },
};

export default meta;
type Story = StoryObj<typeof TextField>;

export const Playground: Story = {};

export const BothThemes: Story = {
  render: () => (
    <ThemePair>
      <div style={{ width: '100%' }}>
        <TextField label="Workout name" placeholder="Push day" />
      </div>
      <div style={{ width: '100%' }}>
        <TextField label="Notes" hint="Shown in your history" />
      </div>
      <div style={{ width: '100%' }}>
        <TextField label="Workout name" error="Required" />
      </div>
    </ThemePair>
  ),
};
