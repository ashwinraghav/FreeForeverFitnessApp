import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Mocks `./appUpdate`, the single registration, rather than
 * `virtual:pwa-register/react`. This component used to call `useRegisterSW()` and so did
 * `UpdatePrompt` — two `Workbox` instances over one worker, where only the one that
 * observed `waiting` had a button that did anything.
 */
type CheckResult = 'ready' | 'uptodate' | 'unsupported';
const sw = {
  ready: false,
  install: vi.fn(async () => undefined),
  // Typed on the union, not inferred from the default: otherwise the first assignment
  // pins it to `'uptodate'` and any test returning a different result fails to compile.
  check: vi.fn<() => Promise<CheckResult>>(async () => 'uptodate'),
};
vi.mock('./appUpdate', () => ({
  subscribe: () => () => undefined,
  isUpdateReady: () => sw.ready,
  installUpdate: () => sw.install(),
  checkForUpdate: () => sw.check(),
}));

const { AppUpdateSection } = await import('./AppUpdateSection');

const registration = { waiting: null as unknown, update: vi.fn(async () => undefined) };

beforeEach(() => {
  sw.ready = false;
  sw.install = vi.fn(async () => undefined);
  sw.check = vi.fn<() => Promise<CheckResult>>(async () => 'uptodate');
  registration.waiting = null;
  registration.update = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => registration },
  });
});

describe('AppUpdateSection', () => {
  /*
   * This exists because the only refresh the project owner had found was
   * clearing browsing data, which also deletes their logged sessions. The
   * promise that updating is non-destructive is the point of the feature, so
   * it is asserted rather than assumed.
   */
  it('says up front that updating does not clear your data', () => {
    render(<AppUpdateSection />);
    // Asserted on the promise, not the sentence — the copy is allowed to change,
    // the guarantee is not.
    expect(screen.getByRole('status', { name: 'App version status' })).toHaveTextContent(/never clears/i);
  });

  it('actually polls the server rather than waiting for the browser to look', async () => {
    // The polling itself, and the waiting-for-install that makes its answer true, are
    // `appUpdate`'s job and are tested there against a real registration. What this
    // component owes is that the button reaches it.
    render(<AppUpdateSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(sw.check).toHaveBeenCalledTimes(1);
  });

  it('reports being current when nothing is waiting', async () => {
    sw.check = vi.fn<() => Promise<CheckResult>>(async () => 'uptodate');
    render(<AppUpdateSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(screen.getByRole('status', { name: 'App version status' })).toHaveTextContent(/newest version/i);
    expect(screen.queryByRole('button', { name: 'Install and reload' })).not.toBeInTheDocument();
  });

  it('offers the install once a build is waiting', async () => {
    sw.check = vi.fn<() => Promise<CheckResult>>(async () => 'ready');
    render(<AppUpdateSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(screen.getByRole('status', { name: 'App version status' })).toHaveTextContent(/ready to install/i);
    await userEvent.click(screen.getByRole('button', { name: 'Install and reload' }));
    // No reload flag to pass. `installUpdate` performs the reload itself, because the
    // library's `updateServiceWorker(reloadPage)` ignores that argument entirely.
    expect(sw.install).toHaveBeenCalledTimes(1);
  });

  it('offers the install without a check when one is already waiting', () => {
    sw.ready = true;
    render(<AppUpdateSection />);
    expect(screen.getByRole('button', { name: 'Install and reload' })).toBeInTheDocument();
  });

  it('offers a data export that does not depend on any backend', () => {
    render(<AppUpdateSection />);
    // Constitution rule 7. The synced exporter needs a Firestore this app has
    // never had, so portability has to work off local storage or not at all.
    expect(screen.getByRole('button', { name: 'Download my data' })).toBeInTheDocument();
  });

  it('degrades honestly where service workers are unavailable', async () => {
    sw.check = vi.fn<() => Promise<CheckResult>>(async () => 'unsupported');
    render(<AppUpdateSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(screen.getByRole('status', { name: 'App version status' })).toHaveTextContent(/cannot check for updates/i);
  });
});
