#!/usr/bin/env node
// One command, no cloud account: start the Firebase Emulator Suite, wait for
// it, load fixtures, and stay running.
//
//   node infra/seed/dev.mjs
//
// This is the command ADR-0010 is about. A contributor needs Node 22 and the
// Firebase CLI and nothing else — no GCP project, no billing account, no keys.
// The project ID is `demo-freeforever`; the `demo-` prefix is a Firebase
// tooling guarantee that no request can reach a real backend, so there is no
// configuration mistake that turns a local run into a cloud bill.
//
// Zero dependencies, for the same reason as seed.mjs: this has to work before
// `pnpm install` has ever succeeded.

import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'demo-freeforever';
const HUB = '127.0.0.1:4400';
const READY_TIMEOUT_MS = 90_000;

const env = {
  ...process.env,
  FIREBASE_PROJECT_ID: PROJECT_ID,
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
};

// Use a globally installed firebase CLI when there is one, so a contributor
// who already has it does not pay a package download on every start.
const hasGlobalCli = (() => {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['firebase']);
  return probe.status === 0;
})();

const [cmd, baseArgs] = hasGlobalCli
  ? ['firebase', []]
  : ['npx', ['--yes', 'firebase-tools']];

/** True if something is already listening on 127.0.0.1:port. */
function portInUse(port) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = (inUse) => {
      socket.destroy();
      resolvePromise(inUse);
    };
    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

// The Hosting emulator wants port 5000, which on macOS is held by AirPlay
// Receiver out of the box. Refusing to start at all over that would make the
// one-command promise false on the most common contributor laptop, so drop
// Hosting and say why. Auth and Firestore are what the app actually needs.
const hostingAvailable = !(await portInUse(5000));
if (!hostingAvailable) {
  console.warn(
    'port 5000 is in use — starting without the Hosting emulator.\n' +
      '  On macOS this is usually AirPlay Receiver:\n' +
      '  System Settings > General > AirDrop & Handoff > AirPlay Receiver: off\n',
  );
}

const only = ['auth', 'firestore', ...(hostingAvailable ? ['hosting'] : [])].join(',');

// Ports come from firebase.json, which is the single source of truth for them.
const emulators = spawn(
  cmd,
  [
    ...baseArgs,
    'emulators:start',
    '--project',
    PROJECT_ID,
    '--only',
    only,
  ],
  { cwd: REPO_ROOT, env, stdio: ['ignore', 'inherit', 'inherit'] },
);

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  emulators.kill(signal ?? 'SIGTERM');
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

emulators.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`\nemulators exited unexpectedly (code ${code})`);
  }
  process.exit(code ?? 0);
});

/**
 * Wait until the emulators are genuinely serving.
 *
 * The hub answers before its children have finished binding, so hub-only
 * polling races: the seed then fails with a bare "fetch failed" on the first
 * request. Ask the hub which emulators it started, then wait for each of those
 * ports to actually accept a connection.
 */
async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  // The hub starts answering as soon as IT is up and registers its children one
  // at a time, so an early response lists only the hub. Wait for the two
  // emulators the seed actually needs to appear by name — a filter over a
  // half-populated payload would produce an empty list, and `[].every()` is
  // true, which is a readiness check that always passes.
  const REQUIRED = ['auth', 'firestore'];

  let running = null;
  while (Date.now() < deadline && !shuttingDown) {
    try {
      const res = await fetch(`http://${HUB}/emulators`);
      if (res.ok) {
        const payload = await res.json();
        if (REQUIRED.every((name) => payload[name]?.port)) {
          running = payload;
          break;
        }
      }
    } catch {
      // Connection refused is the normal state for the first few seconds.
    }
    await sleep(500);
  }
  if (shuttingDown) return false;
  if (!running) {
    throw new Error(`emulator hub did not report auth + firestore within ${READY_TIMEOUT_MS / 1000}s`);
  }

  // A registered emulator is not a serving one: both accept connections about a
  // second before they will answer a request. Each has a root endpoint that
  // responds only once it is genuinely up, so probe that rather than the socket.
  const roots = REQUIRED.map((name) => `http://127.0.0.1:${running[name].port}/`);

  while (Date.now() < deadline && !shuttingDown) {
    const up = await Promise.all(
      roots.map((url) =>
        fetch(url)
          .then((res) => res.ok)
          .catch(() => false),
      ),
    );
    if (up.every(Boolean)) return true;
    await sleep(500);
  }
  if (shuttingDown) return false;
  throw new Error(`emulators did not become ready within ${READY_TIMEOUT_MS / 1000}s`);
}

async function seed() {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [join(HERE, 'seed.mjs')], {
      cwd: REPO_ROOT,
      env,
      stdio: 'inherit',
    });
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : rejectPromise(new Error(`seed exited ${code}`)),
    );
  });
}

async function main() {
  console.log('starting emulators (no GCP account required — ADR-0010)\n');
  const ready = await waitForReady();
  if (!ready) return;

  await seed();

  console.log('\nready.');
  console.log('  emulator UI   http://127.0.0.1:4000');
  console.log('  auth          127.0.0.1:9099');
  console.log('  firestore     127.0.0.1:8080');
  if (hostingAvailable) console.log('  hosting       http://127.0.0.1:5000');
  console.log('\nre-seed without restarting:  node infra/seed/seed.mjs');
  console.log('stop:                        ctrl-c\n');
}

main().catch((err) => {
  console.error(err.message);
  shutdown();
  process.exitCode = 1;
});
