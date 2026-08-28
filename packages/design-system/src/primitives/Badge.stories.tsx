import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { Badge } from './Badge.js';

const meta = {
  title: 'Primitives/Badge',
  component: Badge,
  args: { children: 'PR', tone: 'success' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Tones: Story = {
  name: 'Tones (each carries a glyph, so it survives greyscale)',
  render: () => (
    <ThemePair>
      <Badge tone="neutral">Draft</Badge>
      <Badge tone="info">Deload</Badge>
      <Badge tone="success">PR</Badge>
      <Badge tone="attention">Overdue</Badge>
      <Badge tone="danger">Failed</Badge>
    </ThemePair>
  ),
};
