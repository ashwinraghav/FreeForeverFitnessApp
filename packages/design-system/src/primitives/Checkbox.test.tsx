import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from './Checkbox.js';

describe('Checkbox', () => {
  it('is a labelled checkbox', () => {
    render(<Checkbox>Warm-up set</Checkbox>);
    expect(screen.getByRole('checkbox', { name: 'Warm-up set' })).toBeInTheDocument();
  });

  it('toggles on click', async () => {
    const onChange = vi.fn();
    render(<Checkbox onChange={onChange}>Warm-up set</Checkbox>);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('sets the indeterminate DOM property, which has no HTML attribute', () => {
    render(<Checkbox indeterminate>Warm-up set</Checkbox>);
    const box = screen.getByRole('checkbox');
    expect(box).toBeInstanceOf(HTMLInputElement);
    expect((box as HTMLInputElement).indeterminate).toBe(true);
    // Mixed is not checked - the two states must stay distinguishable.
    expect(box).not.toBeChecked();
  });

  it('signals its state with a shape, not only a colour', () => {
    const { container } = render(<Checkbox defaultChecked>Warm-up set</Checkbox>);
    expect(container.querySelector('.ff-checkbox__control svg')).toBeInTheDocument();
  });
});
