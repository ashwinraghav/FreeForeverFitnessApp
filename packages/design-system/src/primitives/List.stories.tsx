import type { Meta, StoryObj } from '@storybook/react';

import { ThemePair } from '../lib/ThemePair.js';
import { Badge } from './Badge.js';
import { List, ListItem } from './List.js';

const meta: Meta<typeof List> = {
  title: 'Primitives/List',
  component: List,
};

export default meta;
type Story = StoryObj<typeof List>;

export const Playground: Story = {
  args: {
    label: 'Exercises',
    children: (
      <>
        <ListItem trailing="3 x 5">Back squat</ListItem>
        <ListItem trailing="3 x 8">Bench press</ListItem>
      </>
    ),
  },
};

export const BothThemes: Story = {
  name: 'Both themes (static rows and activatable rows, both 48px)',
  render: () => (
    <ThemePair>
      <div style={{ width: '100%' }}>
        <List label="Exercises">
          <ListItem trailing="3 x 5">Back squat</ListItem>
          <ListItem trailing={<Badge tone="success">PR</Badge>}>Deadlift</ListItem>
          <ListItem onActivate={() => {}} trailing="3 x 8">
            Bench press
          </ListItem>
        </List>
      </div>
    </ThemePair>
  ),
};
