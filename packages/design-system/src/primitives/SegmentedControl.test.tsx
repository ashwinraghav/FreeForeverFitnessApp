import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { SegmentedControl } from './SegmentedControl.js';

const options = [
  { value: 'kg', label: 'kg' },
  { value: 'lb', label: 'lb' },
];

function Harness() {
  const [value, setValue] = useState('kg');
  return (
    <SegmentedControl options={options} value={value} onValueChange={setValue} label="Units" />
  );
}

describe('SegmentedControl', () => {
  it('is a radiogroup - it picks a value, it does not reveal a panel', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Units' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('marks the current option', () => {
    render(<Harness />);
    expect(screen.getByRole('radio', { name: 'kg' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'lb' })).toHaveAttribute('aria-checked', 'false');
  });

  it('selects on click', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('radio', { name: 'lb' }));
    expect(screen.getByRole('radio', { name: 'lb' })).toHaveAttribute('aria-checked', 'true');
  });

  it('moves with arrow keys, like a native radio group', async () => {
    render(<Harness />);
    screen.getByRole('radio', { name: 'kg' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'lb' })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps one tab stop for the whole group', () => {
    render(<Harness />);
    const radios = screen.getAllByRole('radio');
    expect(radios.filter((radio) => radio.getAttribute('tabindex') === '0')).toHaveLength(1);
  });
});
