import { deleteApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';
import type { UserId } from '../../common/ids.js';
import { createFirebaseClients, type FirebaseClients } from '../firebase.js';

/**
 * Harness for the emulator suite (`*.emu.test.ts`). Run under:
 *
 *   firebase emulators:exec --project demo-freeforever-sync --only firestore,auth \
 *     "pnpm --filter @freeforever/data test:sync:emu"
 *
 * The Firestore emulator loads the repository's real `firestore.rules` (via
 * firebase.json), so every write these tests make is judged by the production
 * ruleset — the suite fails loudly without the emulators rather than passing
 * quietly, per ADR-0015.
 *
 * The demo- project prefix keeps the Auth emulator self-contained: no real
 * project, no real API key, nothing these tests could reach in production.
 */

export const EMULATOR_PROJECT = 'demo-freeforever-sync';

const FIRESTORE_HOST = process.env['FIRESTORE_EMULATOR_HOST'] ?? '127.0.0.1:8080';
const AUTH_HOST = process.env['FIREBASE_AUTH_EMULATOR_HOST'] ?? '127.0.0.1:9099';

let clientCounter = 0;
const openClients: FirebaseClients[] = [];

/** A fresh client: its own app, its own (memory) cache — a separate "device". */
export function newDevice(): FirebaseClients {
  clientCounter += 1;
  const clients = createFirebaseClients({
    config: {
      apiKey: 'fake-emulator-api-key',
      authDomain: 'localhost',
      projectId: EMULATOR_PROJECT,
      appId: '1:000000000000:web:emulator',
    },
    name: `device-${clientCounter}-${Date.now()}`,
    cache: 'memory', // persistent cache needs IndexedDB; Node has none (see SYNC.md)
    emulators: { firestore: FIRESTORE_HOST, auth: AUTH_HOST },
  });
  openClients.push(clients);
  return clients;
}

export async function closeAllDevices(): Promise<void> {
  await Promise.allSettled(openClients.map((clients) => deleteApp(clients.app)));
  openClients.length = 0;
}

let accountCounter = 0;

/** A unique account per test, so suites cannot couple through the emulator. */
export function uniqueEmail(): string {
  accountCounter += 1;
  return `user-${Date.now()}-${accountCounter}@example.test`;
}

export async function signUp(auth: Auth, email: string, password = 'correct-horse-9'): Promise<UserId> {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  return credential.user.uid as UserId;
}

export async function signIn(auth: Auth, email: string, password = 'correct-horse-9'): Promise<UserId> {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user.uid as UserId;
}

/** Polls until `condition` holds. Listener delivery is async; tests wait, not sleep. */
export async function until(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
