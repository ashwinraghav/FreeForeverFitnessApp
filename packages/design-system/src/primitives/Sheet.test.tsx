import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Sheet } from './Sheet.js';

describe('Sheet', () => {
  it('renders nothing when closed', () => {
    render(
      <Sheet open={false} onClose={vi.fn()} title="Rest timer">
        body
      </Sheet>,
    );
    expect(screen.queryByText('body')).not.toBeInTheDocument();
  });

  it('is a labelled region rather than a modal by default', () => {
    // CLAUDE.md: no modals during a workout. A Sheet must not trap the user.
    render(
      <Sheet open onClose={vi.fn()} title="Rest timer">
        body
      </Sheet>,
    );
    expect(screen.getByRole('region', { name: 'Rest timer' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not render a scrim unless explicitly made modal', () => {
    const { container } = render(
      <Sheet open onClose={vi.fn()} title="Rest timer">
        body
      </Sheet>,
    );
    expect(container.querySelector('[data-ff-scrim]')).not.toBeInTheDocument();
  });

  it('becomes a dialog when modal is opted into', () => {
    render(
      <Sheet open modal onClose={vi.fn()} title="Rest timer">
        body
      </Sheet>,
    );
    expect(screen.getByRole('dialog', { name: 'Rest timer' })).toHaveAttribute('aria-modal', 'true');
  });

  it('closes on the close button', async () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Rest timer">
        body
      </Sheet>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Rest timer">
        body
      </Sheet>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
