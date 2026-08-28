import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Tabs } from './Tabs.js';

const items = [
  { id: 'history', label: 'History', content: 'Past workouts' },
  { id: 'prs', label: 'PRs', content: 'Personal records' },
  { id: 'notes', label: 'Notes', content: 'Session notes' },
];

function Harness() {
  const [value, setValue] = useState('history');
  return <Tabs items={items} value={value} onValueChange={setValue} label="Workout detail" />;
}

describe('Tabs', () => {
  it('renders a named tablist', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Workout detail' })).toBeInTheDocument();
  });

  it('shows only the selected panel', () => {
    render(<Harness />);
    expect(screen.getByText('Past workouts')).toBeVisible();
    expect(screen.getByText('Personal records')).not.toBeVisible();
  });

  it('keeps exactly one tab in the tab order (roving tabindex)', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.filter((tab) => tab.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('moves with the right arrow', async () => {
    render(<Harness />);
    screen.getByRole('tab', { name: 'History' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'PRs' })).toHaveAttribute('aria-selected', 'true');
  });

  it('wraps from the first tab to the last with the left arrow', async () => {
    render(<Harness />);
    screen.getByRole('tab', { name: 'History' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
  });

  it('jumps to the ends with Home and End', async () => {
    render(<Harness />);
    screen.getByRole('tab', { name: 'History' }).focus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  });

  it('selects on click', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('tab', { name: 'PRs' }));
    expect(screen.getByText('Personal records')).toBeVisible();
  });

  it('wires each panel to its tab', () => {
    render(<Harness />);
    const tab = screen.getByRole('tab', { name: 'History' });
    const panel = screen.getByRole('tabpanel');
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
  });
});
