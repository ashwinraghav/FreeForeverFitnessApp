import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { List, ListItem } from './List.js';

describe('List', () => {
  it('renders a named list of items', () => {
    render(
      <List label="Exercises">
        <ListItem>Back squat</ListItem>
        <ListItem>Bench press</ListItem>
      </List>,
    );
    expect(screen.getByRole('list', { name: 'Exercises' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders a static row without a button', () => {
    render(
      <List>
        <ListItem>Back squat</ListItem>
      </List>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('makes the whole row a button when activatable', async () => {
    const onActivate = vi.fn();
    render(
      <List>
        <ListItem onActivate={onActivate}>Back squat</ListItem>
      </List>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Back squat' }));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('renders leading and trailing slots', () => {
    render(
      <List>
        <ListItem leading={<span>1</span>} trailing="3 x 5">
          Back squat
        </ListItem>
      </List>,
    );
    expect(screen.getByText('3 x 5')).toBeInTheDocument();
  });

  it('lets an explicit label override self-describing row text', () => {
    render(
      <List>
        <ListItem onActivate={vi.fn()} activateLabel="Open back squat history">
          Back squat
        </ListItem>
      </List>,
    );
    expect(screen.getByRole('button', { name: 'Open back squat history' })).toBeInTheDocument();
  });
});
