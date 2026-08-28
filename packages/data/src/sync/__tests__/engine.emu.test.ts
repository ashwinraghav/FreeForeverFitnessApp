import {
  deleteDoc,
  disableNetwork,
  doc,
  enableNetwork,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import type { DocumentEnvelope } from '../../common/envelope.js';
import { paths } from '../../collections.js';
import { SyncEngine } from '../engine.js';
import { statesEqual } from '../runner.js';
import type { DraftBody, WriteContext } from '../writes.js';
import { saveWorkout } from '../writes.js';
import { closeAllDevices, newDevice, signIn, signUp, uniqueEmail, until } from './emuHarness.js';
import { makeWorkout } from './fixtures.js';

/**
 * The engine end-to-end against the emulator and the production rules:
 * aggregates maintained on write (including offline), flushed within the rules'
 * envelope protocol, converging across devices, and rebuilding when the stored
 * fold is unusable.
 */

afterAll(closeAllDevices);

function draftOf<T extends DocumentEnvelope>(document: T): DraftBody<T> {
  const { sv: _sv, uid: _uid, createdAt: _c, updatedAt: _u, ...body } = document;
  return body as unknown as DraftBody<T>;
}

const FAST = { flushQuietMs: 25, flushMinIntervalMs: 0 };

const benchSession = (id: string, localDate: string, weightKg: number) =>
  makeWorkout({
    id,
    localDate,
    exercises: [{ id: 'e1', sets: [{ id: 's1', weightKg, reps: 5 }] }],
  });

describe('SyncEngine', () => {
  it('folds writes into aggregates, flushes within the rules, and a second device converges', async () => {
    const email = uniqueEmail();
    const deviceA = newDevice();
    const uid = await signUp(deviceA.auth, email);
    const ctx: WriteContext = { firestore: deviceA.firestore, uid };

    const engineA = new SyncEngine({ firestore: deviceA.firestore, uid, ...FAST });
    await engineA.start();
    await engineA.whenPrimed();

    await saveWorkout(ctx, draftOf(benchSession('w1', '2026-08-24', 100)));
    await saveWorkout(ctx, draftOf(benchSession('w2', '2026-08-31', 105)));

    await until(() => engineA.getAggregate('training_volume').weeks.length === 2);
    const volume = engineA.getAggregate('training_volume');
    expect(volume.weeks[0]?.volumeKg).toBe(500);
    expect(volume.weeks[1]?.volumeKg).toBe(525);

    // The flush must satisfy the production rules' aggregate envelope.
    await engineA.flushNow();
    const stored = await getDoc(doc(deviceA.firestore, paths.aggregate(uid, 'training_volume')));
    expect(stored.exists()).toBe(true);
    expect(stored.get('version')).toBe(1);

    // A cold device: loads the synced fold, then converges through its own listeners.
    const deviceB = newDevice();
    await signIn(deviceB.auth, email);
    const engineB = new SyncEngine({ firestore: deviceB.firestore, uid, ...FAST });
    await engineB.start();
    await engineB.whenPrimed();
    await until(() =>
      statesEqual(
        engineB.getAggregate('training_volume'),
        engineA.getAggregate('training_volume'),
      ),
    );
    expect(engineB.getAggregate('exercise_progress').series[0]?.points).toHaveLength(2);

    engineA.stop();
    engineB.stop();
  });

  it('updates aggregates immediately while offline — no network, no spinner', async () => {
    const device = newDevice();
    const uid = await signUp(device.auth, uniqueEmail());
    const engine = new SyncEngine({ firestore: device.firestore, uid, ...FAST });
    await engine.start();
    await engine.whenPrimed();
    // The engine's own context: a pending write's updatedAt sentinel is invisible
    // to the delta listeners, so immediate folding comes from the write hook.
    const ctx = engine.writeContext();

    await disableNetwork(device.firestore);
    const ack = saveWorkout(ctx, draftOf(benchSession('wBasement', '2026-08-24', 80)));

    // The fold happens from the local queue, before any server involvement.
    await until(() => engine.getAggregate('training_volume').weeks.length === 1);
    expect(engine.getAggregate('training_volume').weeks[0]?.volumeKg).toBe(400);

    await enableNetwork(device.firestore);
    await ack;
    engine.stop();
  });

  it('rebuilds from source when the stored aggregate is rules-valid but unusable', async () => {
    const device = newDevice();
    const uid = await signUp(device.auth, uniqueEmail());
    const ctx: WriteContext = { firestore: device.firestore, uid };
    await saveWorkout(ctx, draftOf(benchSession('w1', '2026-08-24', 100)));

    // A hollow fold: passes every rule, carries none of the reducer's internal
    // index. Version matches, so it is adopted — then refused on first event.
    await setDoc(doc(device.firestore, paths.aggregate(uid, 'training_volume')), {
      sv: 1,
      uid,
      id: 'training_volume',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      version: 1,
      sequenceByKind: {},
      computedAt: serverTimestamp(),
      state: { kind: 'training_volume', weeks: [], monthlyVolumeKg: {} },
    });

    const engine = new SyncEngine({ firestore: device.firestore, uid, ...FAST });
    await engine.start();
    await engine.whenPrimed();
    await until(() => engine.getAggregate('training_volume').weeks.length === 1);
    expect(engine.getAggregate('training_volume').weeks[0]?.volumeKg).toBe(500);
    engine.stop();
  });

  it('folds a local hard delete via noteLocalDelete', async () => {
    const device = newDevice();
    const uid = await signUp(device.auth, uniqueEmail());
    const ctx: WriteContext = { firestore: device.firestore, uid };
    const engine = new SyncEngine({ firestore: device.firestore, uid, ...FAST });
    await engine.start();
    await engine.whenPrimed();

    await saveWorkout(ctx, draftOf(benchSession('wDoomed', '2026-08-24', 100)));
    await until(() => engine.getAggregate('training_volume').weeks.length === 1);

    await deleteDoc(doc(device.firestore, `users/${uid}/workouts/wDoomed`));
    engine.noteLocalDelete('workouts', 'wDoomed');
    await until(() => engine.getAggregate('training_volume').weeks.length === 0);
    engine.stop();
  });

  it('repair() reports no drift on a consistent engine', async () => {
    const device = newDevice();
    const uid = await signUp(device.auth, uniqueEmail());
    const ctx: WriteContext = { firestore: device.firestore, uid };
    const engine = new SyncEngine({ firestore: device.firestore, uid, ...FAST });
    await engine.start();
    await engine.whenPrimed();
    await saveWorkout(ctx, draftOf(benchSession('w1', '2026-08-24', 100)));
    await until(() => engine.getAggregate('training_volume').weeks.length === 1);

    expect(await engine.repair()).toEqual([]);
    engine.stop();
  });
});
