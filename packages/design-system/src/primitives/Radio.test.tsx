import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Radio } from './Radio.js';

describe('Radio', () => {
  it('renders a named radio', () => {
    render(<Radio name="units">Kilograms</Radio>);
    expect(screen.getByRole('radio', { name: 'Kilograms' })).toBeInTheDocument();
  });

  it('behaves as a group through the shared name', async () => {
    render(
      <>
        <Radio name="units" value="kg">
          Kilograms
        </Radio>
        <Radio name="units" value="lb">
          Pounds
        </Radio>
      </>,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Pounds' }));
    expect(screen.getByRole('radio', { name: 'Pounds' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Kilograms' })).not.toBeChecked();
  });

  it('does not toggle when disabled', async () => {
    render(
      <Radio name="units" disabled>
        Kilograms
      </Radio>,
    );
    await userEvent.click(screen.getByRole('radio'));
    expect(screen.getByRole('radio')).not.toBeChecked();
  });
});
