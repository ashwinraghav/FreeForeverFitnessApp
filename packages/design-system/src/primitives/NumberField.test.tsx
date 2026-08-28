import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { NumberField } from './NumberField.js';

type Props = ComponentProps<typeof NumberField>;

/** Stateful harness: a controlled field only behaves correctly if its value comes back. */
function Harness({
  initial = null,
  onValueChange,
  ...props
}: Partial<Omit<Props, 'value' | 'onValueChange'>> & {
  initial?: number | null;
  onValueChange?: (value: number | null) => void;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <NumberField
      label="Weight"
      unit="kg"
      {...props}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
    />
  );
}

describe('NumberField', () => {
  it('never opens a generic keyboard on mobile', () => {
    render(<Harness />);
    // The single most important attribute in this package: a generic keyboard mid-set
    // costs an extra tap and covers the screen. There is no prop to turn it off.
    expect(screen.getByLabelText('Weight')).toHaveAttribute('inputmode', 'decimal');
  });

  it('shows the ghost value when nothing has been entered, marked as a ghost', () => {
    render(<Harness initial={null} ghostValue={60} />);
    const input = screen.getByLabelText('Weight');
    expect(input).toHaveValue('60');
    expect(input).toHaveAttribute('data-ff-ghost', 'true');
  });

  it('marks an entered value as not a ghost, so the two are distinguishable', () => {
    render(<Harness initial={62.5} ghostValue={60} />);
    const input = screen.getByLabelText('Weight');
    expect(input).toHaveValue('62.5');
    expect(input).toHaveAttribute('data-ff-ghost', 'false');
  });

  it('renders both steppers with names derived from the label', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Increase Weight' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decrease Weight' })).toBeInTheDocument();
  });

  it('steps up from the ghost value rather than from zero', async () => {
    const onValueChange = vi.fn();
    render(<Harness initial={null} ghostValue={60} step={2.5} onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Increase Weight' }));
    expect(onValueChange).toHaveBeenCalledWith(62.5);
  });

  it('clamps a step down to min', async () => {
    const onValueChange = vi.fn();
    render(<Harness initial={1} step={5} min={0} onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Decrease Weight' }));
    expect(onValueChange).toHaveBeenCalledWith(0);
  });

  it('clears to null rather than to zero when emptied', async () => {
    const onValueChange = vi.fn();
    render(<Harness initial={60} onValueChange={onValueChange} />);
    await userEvent.clear(screen.getByLabelText('Weight'));
    // An empty set and a set of 0 reps are different facts.
    expect(onValueChange).toHaveBeenCalledWith(null);
    expect(screen.getByLabelText('Weight')).toHaveValue('');
  });

  it('accepts a comma decimal separator', async () => {
    const onValueChange = vi.fn();
    render(<Harness initial={null} onValueChange={onValueChange} />);
    await userEvent.type(screen.getByLabelText('Weight'), '2,5');
    expect(onValueChange).toHaveBeenLastCalledWith(2.5);
  });

  it('describes the unit rather than folding it into the label', () => {
    render(<Harness unit="kg" />);
    expect(screen.getByLabelText('Weight')).toHaveAccessibleDescription(/kg/);
  });

  it('announces an error and marks the input invalid', () => {
    render(<Harness error="Enter a weight" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a weight');
    expect(screen.getByLabelText('Weight')).toHaveAttribute('aria-invalid', 'true');
  });

  it('uses mid-set steppers, because typing while holding a dumbbell is not realistic', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Increase Weight' })).toHaveClass(
      'ff-icon-button--xl',
    );
  });

  it('keeps a hidden label available to assistive technology', () => {
    render(<Harness labelHidden />);
    expect(screen.getByLabelText('Weight')).toBeInTheDocument();
  });
});
