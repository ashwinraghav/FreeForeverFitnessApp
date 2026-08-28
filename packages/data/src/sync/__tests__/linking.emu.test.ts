import { EmailAuthProvider, signInWithEmailAndPassword } from 'firebase/auth';
import { disableNetwork, doc, enableNetwork, getDoc } from 'firebase/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import type { DocumentEnvelope } from '../../common/envelope.js';
import type { UserId } from '../../common/ids.js';
import { exportUserData } from '../export.js';
import { MemoryKeyValueStore } from '../kv.js';
import { LinkError, linkAnonymousAccount, resumePendingLink } from '../linking.js';
import { ensureSignedIn } from '../firebase.js';
import type { DraftBody, WriteContext } from '../writes.js';
import { saveWorkout } from '../writes.js';
import { closeAllDevices, newDevice, signUp, uniqueEmail } from './emuHarness.js';
import { makeWorkout } from './fixtures.js';

/**
 * The anonymous→linked upgrade against the real Auth emulator, covering every
 * case the brief names: in-place linking, the target-account-already-has-data
 * merge, a failure midway (wrong password after the conflict), and resuming a
 * merge that crashed between the account switch and the import.
 */

afterAll(closeAllDevices);

const PASSWORD = 'correct-horse-9';

function draftOf<T extends DocumentEnvelope>(document: T): DraftBody<T> {
  const { sv: _sv, uid: _uid, createdAt: _c, updatedAt: _u, ...body } = document;
  return body as unknown as DraftBody<T>;
}

const session = (id: string) =>
  makeWorkout({
    id,
    localDate: '2026-08-24',
    exercises: [{ id: 'e1', sets: [{ id: 's1', weightKg: 100, reps: 5 }] }],
  });

describe('linkAnonymousAccount', () => {
  it('upgrades in place: same uid, data untouched, no longer anonymous', async () => {
    const device = newDevice();
    const anon = await ensureSignedIn(device.auth);
    expect(anon.isAnonymous).toBe(true);
    const uid = anon.uid as UserId;
    await saveWorkout({ firestore: device.firestore, uid }, draftOf(session('wAnon')));

    const outcome = await linkAnonymousAccount(
      { auth: device.auth, firestore: device.firestore, journal: new MemoryKeyValueStore() },
      EmailAuthProvider.credential(uniqueEmail(), PASSWORD),
    );

    expect(outcome.kind).toBe('linked-in-place');
    expect(device.auth.currentUser?.uid).toBe(uid);
    expect(device.auth.currentUser?.isAnonymous).toBe(false);
    const kept = await getDoc(doc(device.firestore, `users/${uid}/workouts/wAnon`));
    expect(kept.exists()).toBe(true);
  });

  it('merges into an existing account when the credential is already in use', async () => {
    // The existing account, with its own history — set up from another device.
    const email = uniqueEmail();
    const deviceOld = newDevice();
    const existingUid = await signUp(deviceOld.auth, email, PASSWORD);
    await saveWorkout(
      { firestore: deviceOld.firestore, uid: existingUid },
      draftOf(session('wExisting')),
    );

    // A fresh install: anonymous, with new training history.
    const deviceNew = newDevice();
    const anon = await ensureSignedIn(deviceNew.auth);
    const anonUid = anon.uid as UserId;
    await saveWorkout({ firestore: deviceNew.firestore, uid: anonUid }, draftOf(session('wNewPhone')));

    const journal = new MemoryKeyValueStore();
    const outcome = await linkAnonymousAccount(
      { auth: deviceNew.auth, firestore: deviceNew.firestore, journal },
      EmailAuthProvider.credential(email, PASSWORD),
    );

    expect(outcome.kind).toBe('merged-into-existing');
    if (outcome.kind !== 'merged-into-existing') return;
    expect(outcome.toUid).toBe(existingUid);
    expect(outcome.report.failures).toEqual([]);

    // Both histories under the surviving account: nothing lost, either side.
    for (const id of ['wExisting', 'wNewPhone']) {
      const kept = await getDoc(doc(deviceOld.firestore, `users/${existingUid}/workouts/${id}`));
      expect(kept.exists(), id).toBe(true);
    }

    // The journal is spent; a restart resumes nothing.
    expect(await journal.get('link.state')).toBeNull();
  });

  it('a failure after the conflict leaves the user anonymous with data intact', async () => {
    const email = uniqueEmail();
    const deviceOld = newDevice();
    await signUp(deviceOld.auth, email, PASSWORD);

    const deviceNew = newDevice();
    const anon = await ensureSignedIn(deviceNew.auth);
    const anonUid = anon.uid as UserId;
    await saveWorkout({ firestore: deviceNew.firestore, uid: anonUid }, draftOf(session('wSafe')));

    // The credential collides, and the sign-in half then fails (wrong password):
    // the exact midway failure the flow is ordered around.
    const attempt = linkAnonymousAccount(
      { auth: deviceNew.auth, firestore: deviceNew.firestore, journal: new MemoryKeyValueStore() },
      EmailAuthProvider.credential(email, 'not-the-password-1'),
    );
    await expect(attempt).rejects.toSatisfy(
      (error: unknown) => error instanceof LinkError && error.stage === 'sign-in' && error.dataIntact,
    );

    expect(deviceNew.auth.currentUser?.uid).toBe(anonUid); // still anonymous
    const kept = await getDoc(doc(deviceNew.firestore, `users/${anonUid}/workouts/wSafe`));
    expect(kept.exists()).toBe(true);
  });

  it('resumePendingLink completes a merge that crashed after the account switch', async () => {
    const email = uniqueEmail();
    const deviceOld = newDevice();
    const targetUid = await signUp(deviceOld.auth, email, PASSWORD);

    // The "crashed" device: anonymous data exported and journalled, account
    // switched — and then nothing, as if the app died before importing.
    const device = newDevice();
    const anon = await ensureSignedIn(device.auth);
    const anonUid = anon.uid as UserId;
    await saveWorkout({ firestore: device.firestore, uid: anonUid }, draftOf(session('wResumed')));
    const backup = await exportUserData(device.firestore, anonUid, { source: 'auto' });
    const journal = new MemoryKeyValueStore();
    await journal.set('link.backup', JSON.stringify(backup));
    await journal.set(
      'link.state',
      JSON.stringify({ phase: 'switched', fromUid: anonUid, toUid: targetUid }),
    );
    await signInWithEmailAndPassword(device.auth, email, PASSWORD);

    // Next launch.
    const report = await resumePendingLink({ auth: device.auth, firestore: device.firestore, journal });
    expect(report?.failures).toEqual([]);
    const imported = await getDoc(doc(device.firestore, `users/${targetUid}/workouts/wResumed`));
    expect(imported.exists()).toBe(true);
    expect(await journal.get('link.state')).toBeNull();
  });
});

describe('exportUserData', () => {
  it('works offline, from the cache, with no account beyond the anonymous uid', async () => {
    const device = newDevice();
    const anon = await ensureSignedIn(device.auth);
    const uid = anon.uid as UserId;
    const ctx: WriteContext = { firestore: device.firestore, uid };

    await disableNetwork(device.firestore);
    void saveWorkout(ctx, draftOf(session('wExported'))); // queued; cache is enough

    // Give the SDK a beat to register the queued mutation, then export.
    const workoutsOf = async (): Promise<number> =>
      (await exportUserData(device.firestore, uid, { source: 'cache' })).collections['workouts']
        ?.length ?? 0;
    const deadline = Date.now() + 5_000;
    while ((await workoutsOf()) === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const data = await exportUserData(device.firestore, uid, { source: 'cache' });
    expect(data.format).toBe('thefreeforeverfitnessapp.export');
    expect(data.collections['workouts']).toHaveLength(1);
    const workout = data.collections['workouts']?.[0] as Record<string, unknown>;
    expect(workout['id']).toBe('wExported');
    // Open format: envelope timestamps flatten to ISO-8601 strings.
    expect(String(workout['createdAt'])).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);

    await enableNetwork(device.firestore);
  });
});
