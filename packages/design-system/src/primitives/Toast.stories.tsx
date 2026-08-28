import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { Toast } from './Toast.js';

const meta = {
  title: 'Primitives/Toast',
  component: Toast,
  args: { children: 'Set logged', tone: 'success' },
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Tones: Story = {
  name: 'Tones (polite for routine, assertive only for danger)',
  render: () => (
    <ThemePair>
      <Toast tone="info">Synced 3 workouts</Toast>
      <Toast tone="success">Set logged</Toast>
      <Toast tone="danger">Could not save - retrying</Toast>
    </ThemePair>
  ),
};
