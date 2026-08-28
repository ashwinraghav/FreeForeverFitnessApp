import { initializeApp, type FirebaseApp } from 'firebase/app';
import type { AppCheck } from 'firebase/app-check';
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { enforceAppCheck, isLocalDevelopmentHostname, type AppCheckOptions } from './appCheck.js';

/**
 * Firebase client initialisation.
 *
 * The client config is public and committed deliberately (ADR-0010) — it lives
 * with the app shell, which passes it in here. What this module decides is the
 * *shape* of the client:
 *
 * - **Firestore gets the persistent multi-tab cache.** ADR-0005 in one line: the
 *   local cache is the source of truth for a session, the write queue survives a
 *   tab close mid-workout, and two open tabs share one queue instead of racing
 *   two. `cache: 'memory'` exists for Node (tests), where IndexedDB does not.
 * - **App Check is initialised here, before anything touches Firestore or Auth**,
 *   so there is no code path that constructs a client without attestation wired.
 *   It is omitted only when the config carries no provider — the emulator, which
 *   ignores App Check anyway.
 * - **Emulator hosts must be local.** A build that pointed production at
 *   someone's "emulator" would be an exfiltration path; refusing non-local hosts
 *   closes it.
 */

export interface FirebaseClientConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly appId: string;
  readonly storageBucket?: string;
  readonly messagingSenderId?: string;
}

export interface EmulatorConfig {
  /** e.g. `127.0.0.1:8080`. Must be a local host. */
  readonly firestore?: string;
  /** e.g. `127.0.0.1:9099`. Must be a local host. */
  readonly auth?: string;
}

export interface CreateFirebaseClientsOptions {
  readonly config: FirebaseClientConfig;
  /** Named apps allow parallel clients in tests. */
  readonly name?: string;
  /** Default `persistent`. Use `memory` outside a browser. */
  readonly cache?: 'persistent' | 'memory';
  readonly appCheck?: AppCheckOptions;
  readonly emulators?: EmulatorConfig;
}

export interface FirebaseClients {
  readonly app: FirebaseApp;
  readonly firestore: Firestore;
  readonly auth: Auth;
  readonly appCheck: AppCheck | null;
}

function splitHost(value: string, label: string): { host: string; port: number } {
  const separator = value.lastIndexOf(':');
  const host = value.slice(0, separator);
  const port = Number(value.slice(separator + 1));
  if (separator === -1 || Number.isNaN(port)) {
    throw new Error(`${label} emulator address must look like host:port, got "${value}"`);
  }
  if (!isLocalDevelopmentHostname(host)) {
    throw new Error(`${label} emulator host "${host}" is not local; refusing to connect.`);
  }
  return { host, port };
}

export function createFirebaseClients(options: CreateFirebaseClientsOptions): FirebaseClients {
  const app = initializeApp(options.config, options.name);
  // Attestation first: nothing else may be constructed before it.
  const appCheck = options.appCheck !== undefined ? enforceAppCheck(app, options.appCheck) : null;

  const firestore = initializeFirestore(app, {
    localCache:
      options.cache === 'memory'
        ? memoryLocalCache()
        : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  const auth = getAuth(app);

  if (options.emulators?.firestore !== undefined) {
    const { host, port } = splitHost(options.emulators.firestore, 'Firestore');
    connectFirestoreEmulator(firestore, host, port);
  }
  if (options.emulators?.auth !== undefined) {
    splitHost(options.emulators.auth, 'Auth'); // validates shape and locality
    connectAuthEmulator(auth, `http://${options.emulators.auth}`, { disableWarnings: true });
  }

  return { app, firestore, auth, appCheck };
}

/**
 * Anonymous-first (ADR-0009): a uid in hand on first open, no wall. Returns the
 * existing user when auth state has already restored one, so calling this on
 * every boot never mints a second identity for the same install.
 */
export async function ensureSignedIn(auth: Auth): Promise<User> {
  await auth.authStateReady();
  if (auth.currentUser !== null) return auth.currentUser;
  const credential = await signInAnonymously(auth);
  return credential.user;
}
