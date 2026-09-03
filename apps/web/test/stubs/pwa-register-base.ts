/**
 * Stand-in for `virtual:pwa-register`, the non-React entry point.
 *
 * Same reason as `pwa-register.ts` beside it: the virtual module only exists while the
 * VitePWA plugin is running, and tests have no business building a service worker.
 *
 * `appUpdate.ts` imports this one. Inert on purpose — it never calls back, so the store
 * starts with no update waiting, which is the state every test should begin from.
 */
export function registerSW(_options?: {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onRegisteredSW?: (url: string, registration?: ServiceWorkerRegistration) => void;
}): (reloadPage?: boolean) => Promise<void> {
  return async () => undefined;
}
