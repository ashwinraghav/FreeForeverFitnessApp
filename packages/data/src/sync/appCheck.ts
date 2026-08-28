import type { FirebaseApp } from 'firebase/app';
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider,
  type AppCheck,
} from 'firebase/app-check';

/**
 * App Check enforcement (assigned here by the ADR-0023 audit: it belongs beside
 * client initialisation, because an app that can be initialised without it is an
 * app that will eventually ship without it).
 *
 * Two properties this module guarantees:
 *
 * 1. **The debug path cannot ship enabled to production.** `debug: true` is
 *    refused at runtime unless the page is served from a local-development
 *    origin. The check is against the *actual* hostname the code is running on —
 *    not a build flag, an env var, or anything else a misconfigured pipeline
 *    could carry into a release bundle.
 *
 * 2. **No debug token can ever be committed.** The API accepts only the boolean.
 *    `FIREBASE_APPCHECK_DEBUG_TOKEN = true` makes the SDK *generate* a token and
 *    print it to the console, where the developer registers it in the Firebase
 *    console for themselves. There is no parameter that takes a token string, so
 *    there is nothing to paste into a public repository. (SECURITY.md, ADR-0010:
 *    the client config is committed deliberately; secrets never are.)
 */

export interface AppCheckOptions {
  readonly provider:
    | { readonly kind: 'recaptcha-v3'; readonly siteKey: string }
    | { readonly kind: 'recaptcha-enterprise'; readonly siteKey: string };
  /**
   * Local development only: asks the SDK to mint a debug token instead of
   * attesting. Refused — by throw, before any Firebase call — anywhere but a
   * local origin.
   */
  readonly debug?: boolean;
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

export function isLocalDevelopmentHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost');
}

/**
 * Throws unless the current origin is local development. `hostname` is the
 * page's `location.hostname`; `undefined` means there is no page at all (a
 * Node test process), where a browser debug token is inert anyway.
 */
export function assertDebugAllowed(hostname: string | undefined): void {
  if (hostname === undefined) return;
  if (isLocalDevelopmentHostname(hostname)) return;
  throw new Error(
    `App Check debug mode is refused on "${hostname}". ` +
      'It is only available on a local development origin; production builds attest for real.',
  );
}

/** Wires App Check into the app. Call immediately after `initializeApp`. */
export function enforceAppCheck(app: FirebaseApp, options: AppCheckOptions): AppCheck {
  if (options.debug === true) {
    const hostname = (globalThis as { location?: { hostname?: string } }).location?.hostname;
    assertDebugAllowed(hostname);
    (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      true;
  }
  const provider =
    options.provider.kind === 'recaptcha-enterprise'
      ? new ReCaptchaEnterpriseProvider(options.provider.siteKey)
      : new ReCaptchaV3Provider(options.provider.siteKey);
  return initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
}
