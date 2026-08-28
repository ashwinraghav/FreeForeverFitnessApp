import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Toggle } from './Toggle.js';

describe('Toggle', () => {
  it('exposes switch semantics rather than checkbox semantics', () => {
    render(<Toggle>Rest timer</Toggle>);
    expect(screen.getByRole('switch', { name: 'Rest timer' })).toBeInTheDocument();
  });

  it('toggles on click', async () => {
    const onChange = vi.fn();
    render(<Toggle onChange={onChange}>Rest timer</Toggle>);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledOnce();
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('toggles from the keyboard', async () => {
    render(<Toggle>Rest timer</Toggle>);
    await userEvent.tab();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('carries state in knob position, not only in colour', () => {
    const { container } = render(<Toggle defaultChecked>Rest timer</Toggle>);
    expect(container.querySelector('.ff-toggle__knob')).toBeInTheDocument();
  });
});
