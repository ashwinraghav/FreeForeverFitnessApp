import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import WorkoutRoutes from './WorkoutRoutes.js';
import { WORKOUT_STORAGE_KEYS } from './storage/workoutStore.js';

/**
 * A smoke test on the entry point the shell actually renders.
 *
 * The screen has its own suite; what this covers is the wiring between them — the
 * feature's internal routing, the default repository, and the stylesheet import — none
 * of which any other test exercises, and all of which are the difference between a
 * green suite and a working app.
 */

beforeEach(() => {
  for (const key of WORKOUT_STORAGE_KEYS) localStorage.removeItem(key);
});

afterEach(() => {
  cleanup();
  for (const key of WORKOUT_STORAGE_KEYS) localStorage.removeItem(key);
});

describe('the feature entry point', () => {
  it('renders the active session at the feature root', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <WorkoutRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByText('Nothing logged yet')).toBeInTheDocument();
  });

  it('falls back to the session rather than a dead end on an unknown path', () => {
    render(
      <MemoryRouter initialEntries={['/something-that-does-not-exist']}>
        <WorkoutRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByText('Nothing logged yet')).toBeInTheDocument();
  });

  it('defaults to the real device-local repository', () => {
    // No props: the shell renders `<WorkoutRoutes />` with nothing, so the wiring has
    // to be complete inside the feature.
    const app = render(
      <MemoryRouter>
        <WorkoutRoutes />
      </MemoryRouter>,
    );
    expect(app.container.querySelector('.ffw-screen')).not.toBeNull();
    // Bottom-anchored actions, never a top-right "Done" (ADR-0013).
    expect(app.container.querySelector('.ffw-actions')).not.toBeNull();
    // With nothing logged the primary action is the clear-up, not Finish — an empty
    // session is not a workout and must not reach history.
    expect(screen.getByRole('button', { name: 'Clear session' })).toBeInTheDocument();
  });
});
