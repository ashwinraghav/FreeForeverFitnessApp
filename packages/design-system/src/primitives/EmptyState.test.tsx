import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
  it('renders a heading, not just styled text', () => {
    render(<EmptyState title="No workouts yet" />);
    expect(screen.getByRole('heading', { name: 'No workouts yet' })).toBeInTheDocument();
  });

  it('renders the explanatory line', () => {
    render(<EmptyState title="No workouts yet" body="Start one and it will show up here." />);
    expect(screen.getByText('Start one and it will show up here.')).toBeInTheDocument();
  });

  it('hides the glyph from assistive technology', () => {
    const { container } = render(<EmptyState title="No workouts yet" glyph={<span>+</span>} />);
    expect(container.querySelector('.ff-empty__glyph')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders a single action', () => {
    render(<EmptyState title="No workouts yet" action={<button>Start a workout</button>} />);
    expect(screen.getByRole('button', { name: 'Start a workout' })).toBeInTheDocument();
  });
});
