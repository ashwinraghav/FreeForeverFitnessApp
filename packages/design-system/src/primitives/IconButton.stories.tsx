import type { Meta, StoryObj } from '@storybook/react';

import { CloseGlyph, MinusGlyph, PlusGlyph } from '../lib/glyphs.js';
import { ThemePair } from '../lib/ThemePair.js';
import { IconButton } from './IconButton.js';

const meta = {
  title: 'Primitives/IconButton',
  component: IconButton,
  args: { icon: <PlusGlyph />, 'aria-label': 'Add set', variant: 'secondary', size: 'md' },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const BothThemes: Story = {
  name: 'Both themes (every one is named - an unnamed IconButton does not compile)',
  render: () => (
    <ThemePair>
      <div style={{ display: 'flex', gap: 'var(--ff-space-12)' }}>
        <IconButton icon={<MinusGlyph />} aria-label="Decrease weight" variant="secondary" />
        <IconButton icon={<PlusGlyph />} aria-label="Increase weight" variant="secondary" />
        <IconButton icon={<CloseGlyph />} aria-label="Close" variant="ghost" />
        <IconButton icon={<PlusGlyph />} aria-label="Add set" variant="primary" size="xl" />
      </div>
    </ThemePair>
  ),
};
