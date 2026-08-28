#!/usr/bin/env node
// Load fixtures into a RUNNING Firebase Emulator Suite.
//
// Zero dependencies on purpose: Node 22 has global fetch, and this script must
// work before `pnpm install` has ever succeeded. A contributor with Node and
// the Firebase CLI can get a working app and nothing else is required —
// no GCP account, no project, no keys (ADR-0010).
//
// The emulators expose the real REST APIs with an `Authorization: Bearer owner`
// escape hatch that bypasses Security Rules. That is an emulator-only feature;
// `owner` is not a credential and means nothing outside this process.
//
//   node infra/seed/seed.mjs
//
// Env: FIREBASE_PROJECT_ID, FIREBASE_AUTH_EMULATOR_HOST, FIRESTORE_EMULATOR_HOST

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// `demo-` prefixed project IDs are special to the Firebase tooling: they are
// guaranteed never to reach a real backend, so a typo cannot write to someone's
// production project.
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'demo-freeforever';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';

const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

/** Convert plain JSON into the Firestore REST `Value` union. */
function toValue(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') {
    // An ISO-8601 instant becomes a real Firestore timestamp, so date maths in
    // the app behaves the same against fixtures as against production data.
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v)
      ? { timestampValue: v }
      : { stringValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  throw new TypeError(`Unsupported fixture value: ${typeof v}`);
}

function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_')) continue; // fixture commentary, not data
    fields[k] = toValue(v);
  }
  return fields;
}

async function request(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${url} -> ${res.status} ${await res.text()}`);
  }
  return res;
}

async function wipe() {
  // Idempotence matters more than speed here: `pnpm dev` is run dozens of times
  // a day and must always land on the same known state, not on the accumulated
  // residue of yesterday's debugging.
  await request(
    `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE', headers: OWNER },
  );
  await request(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: 'DELETE',
    headers: OWNER,
  });
}

async function seedAuth() {
  const { users } = JSON.parse(await readFile(join(HERE, 'fixtures', 'auth.json'), 'utf8'));

  for (const user of users) {
    const body = {
      localId: user.localId,
      displayName: user.displayName,
      emailVerified: Boolean(user.emailVerified),
    };
    // An anonymous account is simply one with no identifier attached. That is
    // the state every user of this app starts in (ADR-0009).
    if (user.email) body.email = user.email;

    await request(
      `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`,
      { method: 'POST', headers: OWNER, body: JSON.stringify(body) },
    );
  }
  return users.length;
}

async function seedFirestore() {
  const { documents } = JSON.parse(
    await readFile(join(HERE, 'fixtures', 'firestore.json'), 'utf8'),
  );

  const base = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  let count = 0;

  for (const [path, data] of Object.entries(documents)) {
    // Fields must be named explicitly or PATCH is a no-op that reports success.
    const mask = Object.keys(data)
      .filter((k) => !k.startsWith('_'))
      .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
      .join('&');

    await request(`${base}/${path}?${mask}`, {
      method: 'PATCH',
      headers: OWNER,
      body: JSON.stringify({ fields: toFields(data) }),
    });
    count += 1;
  }
  return count;
}

async function main() {
  console.log(`seeding project ${PROJECT_ID}`);
  console.log(`  auth      ${AUTH_HOST}`);
  console.log(`  firestore ${FIRESTORE_HOST}`);

  await wipe();
  const users = await seedAuth();
  const docs = await seedFirestore();

  console.log(`seeded ${users} users, ${docs} documents`);
  console.log(`emulator UI: http://127.0.0.1:4000`);
}

main().catch((err) => {
  console.error('\nseeding failed:', err.message);
  console.error('\nAre the emulators running? Try: node infra/seed/dev.mjs');
  process.exitCode = 1;
});
