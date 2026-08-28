import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Select } from './Select.js';

const options = (
  <>
    <option value="kg">Kilograms</option>
    <option value="lb">Pounds</option>
  </>
);

describe('Select', () => {
  it('is a native select with an associated label', () => {
    render(<Select label="Units">{options}</Select>);
    expect(screen.getByLabelText('Units').tagName).toBe('SELECT');
  });

  it('selects an option', async () => {
    const onChange = vi.fn();
    render(
      <Select label="Units" defaultValue="kg" onChange={onChange}>
        {options}
      </Select>,
    );
    await userEvent.selectOptions(screen.getByLabelText('Units'), 'lb');
    expect(onChange).toHaveBeenCalled();
  });

  it('marks an error state', () => {
    render(
      <Select label="Units" error="Pick one">
        {options}
      </Select>,
    );
    expect(screen.getByLabelText('Units')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Pick one');
  });
});
