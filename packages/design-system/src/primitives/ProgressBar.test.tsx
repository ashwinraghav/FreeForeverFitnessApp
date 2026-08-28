import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressBar } from './ProgressBar.js';

describe('ProgressBar', () => {
  it('is a named progressbar', () => {
    render(<ProgressBar value={0.4} label="Workout progress" />);
    expect(screen.getByRole('progressbar', { name: 'Workout progress' })).toBeInTheDocument();
  });

  it('reports its position as a percentage', () => {
    render(<ProgressBar value={0.4} label="Workout progress" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
  });

  it('clamps out-of-range values instead of overflowing', () => {
    render(<ProgressBar value={1.8} label="Workout progress" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('omits aria-valuenow when indeterminate', () => {
    render(<ProgressBar label="Loading" />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });

  it('prefers human-readable value text over a bare percentage', () => {
    render(<ProgressBar value={0.6} label="Workout progress" valueText="Set 3 of 5" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Set 3 of 5');
  });
});
