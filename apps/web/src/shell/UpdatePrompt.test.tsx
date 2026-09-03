import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  ready: false,
  install: vi.fn(async () => undefined),
  dismiss: vi.fn(),
};

/*
 * Mocks `./appUpdate`, not `virtual:pwa-register/react`.
 *
 * That change is the fix, not an incidental refactor: this component and
 * `AppUpdateSection` each called `useRegisterSW()`, which builds a `Workbox` per call,
 * so there were two registrations over one worker and only whichever instance saw the
 * `waiting` event had a button that did anything.
 */
vi.mock('./appUpdate', () => ({
  subscribe: () => () => undefined,
  isUpdateReady: () => state.ready,
  installUpdate: () => state.install(),
  dismissUpdate: () => state.dismiss(),
}));

const { UpdatePrompt } = await import('./UpdatePrompt');

beforeEach(() => {
  state.ready = false;
  state.install = vi.fn(async () => undefined);
  state.dismiss = vi.fn();
});

describe('UpdatePrompt', () => {
  /*
   * This component exists because prompt-mode registration only parks the new build in
   * `waiting` — without an offer, a returning device stays on whichever build it
   * installed first, forever. A live deploy was found serving a three-day-old bundle for
   * exactly this reason, so the negative case below is the one that must not silently
   * become the only behaviour again.
   */
  it('renders nothing at all when no update is waiting', () => {
    state.ready = false;
    const { container } = render(<UpdatePrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers the update once one is waiting', () => {
    state.ready = true;
    render(<UpdatePrompt />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
  });

  it('hands the install to the one place that owns it', async () => {
    /*
     * This used to assert `updateServiceWorker` was called with `true`, commented as
     * "the reload flag". It passed for months, and `true` did nothing: the library
     * signature is `async (_reloadPage = true)` — underscore-prefixed and unused. The
     * test encoded the misunderstanding rather than catching it.
     *
     * `installUpdate` performs the reload itself, so there is no flag to get wrong.
     */
    state.ready = true;
    render(<UpdatePrompt />);
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(state.install).toHaveBeenCalledTimes(1);
  });

  it('dismisses without applying, because a set in progress outranks a new build', async () => {
    state.ready = true;
    render(<UpdatePrompt />);
    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(state.dismiss).toHaveBeenCalledTimes(1);
    expect(state.install).not.toHaveBeenCalled();
  });

  it('announces without stealing focus, so it cannot interrupt a set', () => {
    state.ready = true;
    render(<UpdatePrompt />);
    // `status`, not `alert` or a dialog: polite, and it never takes focus.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });
});
