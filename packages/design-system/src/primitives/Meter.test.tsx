import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Meter } from './Meter.js';

describe('Meter', () => {
  it('uses the meter role, not progressbar - it is a level, not progress', () => {
    render(<Meter value={80} max={160} label="Protein" unit="g" />);
    expect(screen.getByRole('meter', { name: 'Protein' })).toBeInTheDocument();
  });

  it('reports the range and current value', () => {
    render(<Meter value={80} max={160} label="Protein" unit="g" />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '160');
    expect(meter).toHaveAttribute('aria-valuenow', '80');
  });

  it('announces the band in words as well as colour', () => {
    render(<Meter value={80} max={160} label="Protein" unit="g" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '80 g of 160 g');
  });

  it('classifies a value at or above optimum as on-target', () => {
    render(<Meter value={150} max={160} optimum={140} low={60} label="Protein" />);
    expect(screen.getByRole('meter')).toHaveAttribute('data-ff-band', 'optimum');
  });

  it('classifies a value below low as low', () => {
    render(<Meter value={20} max={160} optimum={140} low={60} label="Protein" />);
    expect(screen.getByRole('meter')).toHaveAttribute('data-ff-band', 'low');
  });

  it('clamps a value above max', () => {
    render(<Meter value={500} max={160} label="Protein" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '160');
  });
});
