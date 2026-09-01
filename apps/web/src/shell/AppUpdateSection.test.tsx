import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sw = { needRefresh: false, updateServiceWorker: vi.fn(async () => undefined) };
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [sw.needRefresh, vi.fn()] as const,
    updateServiceWorker: sw.updateServiceWorker,
  }),
}));

const { AppUpdateSection } = await import('./AppUpdateSection');

const registration = { waiting: null as unknown, update: vi.fn(async () => undefined) };

beforeEach(() => {
  sw.needRefresh = false;
  sw.updateServiceWorker = vi.fn(async () => undefined);
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
    expect(screen.getByRole('status')).toHaveTextContent(/never clears them/i);
  });

  it('actually polls the server rather than waiting for the browser to look', async () => {
    render(<AppUpdateSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(registration.update).toHaveBeenCalled();
  });

  it('reports being current when nothing is waiting', async () => {
    render(<AppUpdateSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(screen.getByRole('status')).toHaveTextContent(/newest version/i);
    expect(screen.queryByRole('button', { name: 'Install and reload' })).not.toBeInTheDocument();
  });

  it('offers the install once a build is waiting', async () => {
    registration.waiting = {};
    render(<AppUpdateSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(screen.getByRole('status')).toHaveTextContent(/ready to install/i);
    await userEvent.click(screen.getByRole('button', { name: 'Install and reload' }));
    expect(sw.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('offers the install without a check when one is already waiting', () => {
    sw.needRefresh = true;
    render(<AppUpdateSection />);
    expect(screen.getByRole('button', { name: 'Install and reload' })).toBeInTheDocument();
  });

  it('degrades honestly where service workers are unavailable', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
    render(<AppUpdateSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(screen.getByRole('status')).toHaveTextContent(/cannot check for updates/i);
  });
});
