import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { ThemePair } from '../lib/ThemePair.js';
import { Tabs } from './Tabs.js';

const meta: Meta<typeof Tabs> = {
  title: 'Primitives/Tabs',
  component: Tabs,
};

export default meta;
type Story = StoryObj<typeof Tabs>;

const items = [
  { id: 'history', label: 'History', content: <p>Past sessions for this lift.</p> },
  { id: 'prs', label: 'PRs', content: <p>Your best set at each rep count.</p> },
  { id: 'notes', label: 'Notes', content: <p>What you wrote last time.</p> },
];

function Demo() {
  const [value, setValue] = useState('history');
  return <Tabs items={items} value={value} onValueChange={setValue} label="Exercise detail" />;
}

export const Playground: Story = { render: () => <Demo /> };

export const BothThemes: Story = {
  name: 'Both themes (arrows move, Home/End jump, one tab stop)',
  render: () => (
    <ThemePair>
      <div style={{ width: '100%' }}>
        <Demo />
      </div>
    </ThemePair>
  ),
};
