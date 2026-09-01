/**
 * Stand-in for `virtual:pwa-register/react`, which only exists when the
 * VitePWA plugin is running. The plugin is not in vitest.config.ts — tests
 * should not be building a service worker — so without this the import fails
 * to resolve and the component cannot be tested at all.
 *
 * Deliberately inert rather than clever: it reports "no update waiting" and
 * does nothing. Tests that care about the update path replace it with
 * `vi.mock`, and this shape is what they mock against.
 */
export function useRegisterSW(): {
  needRefresh: [boolean, (value: boolean) => void];
  updateServiceWorker: (reload?: boolean) => Promise<void>;
} {
  return {
    needRefresh: [false, () => undefined],
    updateServiceWorker: async () => undefined,
  };
}
