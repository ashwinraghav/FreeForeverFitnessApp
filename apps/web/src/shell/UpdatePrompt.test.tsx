import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  needRefresh: false,
  setNeedRefresh: vi.fn(),
  updateServiceWorker: vi.fn(async () => undefined),
};

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [state.needRefresh, state.setNeedRefresh] as const,
    updateServiceWorker: state.updateServiceWorker,
  }),
}));

const { UpdatePrompt } = await import('./UpdatePrompt');

beforeEach(() => {
  state.needRefresh = false;
  state.setNeedRefresh = vi.fn();
  state.updateServiceWorker = vi.fn(async () => undefined);
});

describe('UpdatePrompt', () => {
  /*
   * This component exists because prompt-mode registration only parks the new
   * build in `waiting` — without an offer, a returning device stays on whichever
   * build it installed first, forever. A live deploy was found serving a
   * three-day-old bundle for exactly this reason, so the negative case below is
   * the one that must not silently become the only behaviour again.
   */
  it('renders nothing at all when no update is waiting', () => {
    state.needRefresh = false;
    const { container } = render(<UpdatePrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers the update once one is waiting', () => {
    state.needRefresh = true;
    render(<UpdatePrompt />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
  });

  it('applies the waiting worker and reloads when taken', async () => {
    state.needRefresh = true;
    render(<UpdatePrompt />);
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    // `true` is the reload flag — without it the worker activates and the page
    // keeps running the old bundle, which is the bug this component fixes.
    expect(state.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('dismisses without applying, because a set in progress outranks a new build', async () => {
    state.needRefresh = true;
    render(<UpdatePrompt />);
    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(state.setNeedRefresh).toHaveBeenCalledWith(false);
    expect(state.updateServiceWorker).not.toHaveBeenCalled();
  });

  it('announces without stealing focus, so it cannot interrupt a set', () => {
    state.needRefresh = true;
    render(<UpdatePrompt />);
    // `status`, not `alert` or a dialog: polite, and it never takes focus.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });
});
