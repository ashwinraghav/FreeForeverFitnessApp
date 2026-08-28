import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TextField } from './TextField.js';

describe('TextField', () => {
  it('associates its label with the input', () => {
    render(<TextField label="Workout name" />);
    expect(screen.getByLabelText('Workout name')).toBeInTheDocument();
  });

  it('keeps a hidden label in the accessibility tree', () => {
    render(<TextField label="Workout name" labelHidden />);
    expect(screen.getByLabelText('Workout name')).toBeInTheDocument();
  });

  it('wires a hint as a description', () => {
    render(<TextField label="Workout name" hint="Shown in your history" />);
    expect(screen.getByLabelText('Workout name')).toHaveAccessibleDescription(
      'Shown in your history',
    );
  });

  it('marks and announces an error', () => {
    render(<TextField label="Workout name" error="Required" />);
    expect(screen.getByLabelText('Workout name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });

  it('accepts typing', async () => {
    const onChange = vi.fn();
    render(<TextField label="Workout name" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Workout name'), 'Push');
    expect(onChange).toHaveBeenCalled();
  });
});
