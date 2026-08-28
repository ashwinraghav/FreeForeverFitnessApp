import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { TextField } from './TextField.js';

const meta = {
  title: 'Primitives/TextField',
  component: TextField,
  args: { label: 'Workout name', placeholder: 'Push day' },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

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
