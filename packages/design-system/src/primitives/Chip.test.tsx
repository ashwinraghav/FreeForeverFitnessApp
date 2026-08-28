import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Chip } from './Chip.js';

describe('Chip', () => {
  it('is a toggle button, so selection is exposed to assistive technology', () => {
    render(<Chip selected>Push</Chip>);
    expect(screen.getByRole('button', { name: 'Push', pressed: true })).toBeInTheDocument();
  });

  it('reports the unselected state', () => {
    render(<Chip>Push</Chip>);
    expect(screen.getByRole('button', { name: 'Push', pressed: false })).toBeInTheDocument();
  });

  it('calls onClick', async () => {
    const onClick = vi.fn();
    render(<Chip onClick={onClick}>Push</Chip>);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('meets the shared control geometry', () => {
    render(<Chip>Push</Chip>);
    expect(screen.getByRole('button')).toHaveClass('ff-control');
  });
});
