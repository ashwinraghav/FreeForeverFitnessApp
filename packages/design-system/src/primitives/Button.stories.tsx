import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { Button } from './Button.js';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Log set', variant: 'primary', size: 'md' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Variants: Story = {
  render: () => (
    <ThemePair>
      <Button variant="primary">Log set</Button>
      <Button variant="secondary">Add exercise</Button>
      <Button variant="ghost">Skip</Button>
      <Button variant="danger">Delete workout</Button>
      <Button variant="primary" disabled>
        Unavailable
      </Button>
    </ThemePair>
  ),
};

export const Sizes: Story = {
  name: 'Sizes (all clear 48px; xl is the 56px mid-set size)',
  render: () => (
    <ThemePair>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
      <Button size="xl" variant="primary">
        Mid-set
      </Button>
    </ThemePair>
  ),
};
