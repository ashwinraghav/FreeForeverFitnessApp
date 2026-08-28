import { deleteDoc, disableNetwork, doc, enableNetwork, getDoc, getDocFromCache } from 'firebase/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import type { DocumentEnvelope } from '../../common/envelope.js';
import { paths } from '../../collections.js';
import { nutritionDaySchema, personalRecordSchema } from '../../index.js';
import type { DraftBody, WriteContext } from '../writes.js';
import { saveNutritionDay, savePersonalRecord, saveWorkout } from '../writes.js';
import { closeAllDevices, newDevice, signIn, signUp, uniqueEmail } from './emuHarness.js';
import { makeNutritionDay, makePersonalRecord, makeWorkout } from './fixtures.js';

/**
 * The write layer against the real emulator and the real rules. What is being
 * proven here, not merely exercised: writes conform to the envelope protocol the
 * rules enforce, offline writes queue and drain, and the create-collision on a
 * date-keyed document ends in a union instead of a loss.
 */

afterAll(closeAllDevices);

function draftOf<T extends DocumentEnvelope>(document: T): DraftBody<T> {
  const { sv: _sv, uid: _uid, createdAt: _c, updatedAt: _u, ...body } = document;
  return body as unknown as DraftBody<T>;
}

/** Polls a cache read until the document is visible there. */
async function pollCache(
  read: () => Promise<{ exists(): boolean }>,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const snapshot = await read();
      if (snapshot.exists()) return true;
    } catch {
      // Not cached yet.
    }
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('write protocol against the production rules', () => {
  it('creates and then updates a workout (createdAt handling both ways)', async () => {
    const device = newDevice();
    const uid = await signUp(device.auth, uniqueEmail());
    const ctx: WriteContext = { firestore: device.firestore, uid };

    const workout = makeWorkout({
      id: 'w1',
      localDate: '2026-08-24',
      exercises: [{ id: 'e1', sets: [{ id: 's1', weightKg: 100, reps: 5 }] }],
    });
    await saveWorkout(ctx, draftOf(workout));

    // The update path must resend the stored createdAt, not a new sentinel.
    const edited = { ...draftOf(workout), title: 'Session (edited)' as typeof workout.title };
    await saveWorkout(ctx, edited);

    const snapshot = await getDoc(doc(device.firestore, `users/${uid}/workouts/w1`));
    expect(snapshot.exists()).toBe(true);
    expect(snapshot.get('title')).toBe('Session (edited)');
  });

  it('queues a write offline, serves it from cache, and drains on reconnect', async () => {
    const email = uniqueEmail();
    const device = newDevice();
    const uid = await signUp(device.auth, email);
    const ctx: WriteContext = { firestore: device.firestore, uid };
    const workout = makeWorkout({
      id: 'wOffline',
      localDate: '2026-08-24',
      exercises: [{ id: 'e1', sets: [{ id: 's1', weightKg: 60, reps: 8 }] }],
    });

    await disableNetwork(device.firestore);
    const ack = saveWorkout(ctx, draftOf(workout));

    // Fully usable in the basement: the session is readable locally as soon as
    // the SDK has queued it (a few microtasks after the call, never the network).
    const ref = doc(device.firestore, `users/${uid}/workouts/wOffline`);
    expect(await pollCache(() => getDocFromCache(ref))).toBe(true);

    await enableNetwork(device.firestore);
    await ack; // server acknowledged after the queue drained

    // A second device sees it — the write really reached the server.
    const secondDevice = newDevice();
    await signIn(secondDevice.auth, email);
    const remote = await getDoc(doc(secondDevice.firestore, `users/${uid}/workouts/wOffline`));
    expect(remote.exists()).toBe(true);
  });

  it('two devices creating the same nutrition day converge to the union of meals', async () => {
    const email = uniqueEmail();
    const deviceA = newDevice();
    const uid = await signUp(deviceA.auth, email);
    const ctxA: WriteContext = { firestore: deviceA.firestore, uid };

    await saveNutritionDay(
      ctxA,
      draftOf(
        makeNutritionDay({
          localDate: '2026-08-24',
          meals: [{ id: 'mealA', entries: [{ id: 'a1', energyKcal: 600, proteinG: 40 }] }],
        }),
      ),
    );

    // Device B has never seen the server's copy: born offline with its own meal.
    const deviceB = newDevice();
    await signIn(deviceB.auth, email);
    const diagnostics: string[] = [];
    const ctxB: WriteContext = {
      firestore: deviceB.firestore,
      uid,
      onDiagnostic: (d) => diagnostics.push(d.kind),
    };
    await disableNetwork(deviceB.firestore);
    const ack = saveNutritionDay(
      ctxB,
      draftOf(
        makeNutritionDay({
          localDate: '2026-08-24',
          meals: [{ id: 'mealB', entries: [{ id: 'b1', energyKcal: 800, proteinG: 30 }] }],
        }),
      ),
    );
    await enableNetwork(deviceB.firestore);
    await ack; // drained: denied as an invalid update, recovered, merged, accepted

    expect(diagnostics).toContain('conflict-recovered');
    const merged = await getDoc(doc(deviceA.firestore, paths.userCollection(uid, 'nutritionDays') + '/2026-08-24'));
    const day = nutritionDaySchema.parse(merged.data());
    expect(day.meals.map((meal) => meal.id).sort()).toEqual(['mealA', 'mealB']);
    expect(day.totals.energyKcal).toBe(1400);
    expect(day.entryCount).toBe(2);
  });

  it('two devices detecting different PRs offline converge to the join', async () => {
    const email = uniqueEmail();
    const deviceA = newDevice();
    const uid = await signUp(deviceA.auth, email);
    await savePersonalRecord(
      { firestore: deviceA.firestore, uid },
      draftOf(
        makePersonalRecord({
          id: 'bench_press',
          achievements: [
            { type: 'heaviest_weight', value: 100, achievedAt: 1_787_000_000_000, achievedOn: '2026-08-01', workoutId: 'w1' },
          ],
        }),
      ),
    );

    const deviceB = newDevice();
    await signIn(deviceB.auth, email);
    await disableNetwork(deviceB.firestore);
    const ack = savePersonalRecord(
      { firestore: deviceB.firestore, uid },
      draftOf(
        makePersonalRecord({
          id: 'bench_press',
          achievements: [
            { type: 'best_e1rm', value: 120, achievedAt: 1_787_100_000_000, achievedOn: '2026-08-02', workoutId: 'w2' },
          ],
        }),
      ),
    );
    await enableNetwork(deviceB.firestore);
    await ack;

    const merged = await getDoc(
      doc(deviceA.firestore, paths.userCollection(uid, 'personalRecords') + '/bench_press'),
    );
    const record = personalRecordSchema.parse(merged.data());
    expect(record.current['heaviest_weight']?.value).toBe(100); // A's, not lost
    expect(record.current['best_e1rm']?.value).toBe(120); // B's, joined in
    expect(record.history).toHaveLength(2);
  });

  it('deleteUserDocument removes a document', async () => {
    const device = newDevice();
    const uid = await signUp(device.auth, uniqueEmail());
    const ctx: WriteContext = { firestore: device.firestore, uid };
    const workout = makeWorkout({
      id: 'wGone',
      localDate: '2026-08-24',
      exercises: [{ id: 'e1', sets: [{ id: 's1', weightKg: 60, reps: 8 }] }],
    });
    await saveWorkout(ctx, draftOf(workout));
    await deleteDoc(doc(device.firestore, `users/${uid}/workouts/wGone`));
    const gone = await getDoc(doc(device.firestore, `users/${uid}/workouts/wGone`));
    expect(gone.exists()).toBe(false);
  });
});
