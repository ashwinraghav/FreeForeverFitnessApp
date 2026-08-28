import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  A_DATE,
  COACH,
  OTHER,
  OWNER,
  bodyMetricDoc,
  createTestEnvironment,
  exerciseDoc,
  foodDoc,
  habitDoc,
  linkedContext,
  macroTargetDoc,
  nutritionDayDoc,
  personalRecordDoc,
  profileDoc,
  progressPhotoDoc,
  routineDoc,
  workoutDoc,
} from './harness.js';

/**
 * The baseline: a user owns their data, and nobody else touches it.
 *
 * Every case is asserted in both directions. A suite that only proves the owner can
 * read proves nothing about the attacker.
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnvironment();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

/** Every per-user collection, with a valid document for it. */
const COLLECTIONS: readonly {
  name: string;
  path: (uid: string) => string;
  id: string;
  build: (uid: string, id: string) => Record<string, unknown>;
}[] = [
  { name: 'workouts', path: (uid) => `users/${uid}/workouts`, id: 'w1', build: workoutDoc },
  { name: 'routines', path: (uid) => `users/${uid}/routines`, id: 'r1', build: routineDoc },
  { name: 'exercises', path: (uid) => `users/${uid}/exercises`, id: 'e1', build: exerciseDoc },
  {
    name: 'personalRecords',
    path: (uid) => `users/${uid}/personalRecords`,
    id: 'bench_press',
    build: personalRecordDoc,
  },
  {
    name: 'bodyMetrics',
    path: (uid) => `users/${uid}/bodyMetrics`,
    id: A_DATE,
    build: (uid, id) => bodyMetricDoc(uid, id),
  },
  {
    name: 'progressPhotos',
    path: (uid) => `users/${uid}/progressPhotos`,
    id: 'p1',
    build: progressPhotoDoc,
  },
  { name: 'foods', path: (uid) => `users/${uid}/foods`, id: 'f1', build: foodDoc },
  {
    name: 'nutritionDays',
    path: (uid) => `users/${uid}/nutritionDays`,
    id: A_DATE,
    build: (uid, id) => nutritionDayDoc(uid, id),
  },
  {
    name: 'macroTargets',
    path: (uid) => `users/${uid}/macroTargets`,
    id: 'm1',
    build: macroTargetDoc,
  },
  { name: 'habits', path: (uid) => `users/${uid}/habits`, id: 'h1', build: habitDoc },
];

describe('a user may work with their own data', () => {
  it('creates, reads, updates and deletes their profile', async () => {
    const db = linkedContext(env, OWNER).firestore();
    const ref = doc(db, `users/${OWNER}`);

    await assertSucceeds(setDoc(ref, profileDoc(OWNER)));
    await assertSucceeds(getDoc(ref));
    // Updates carry only what changed plus a fresh updatedAt. Resending createdAt
    // is rejected even by the owner — see envelope.test.ts.
    await assertSucceeds(updateDoc(ref, { theme: 'light', updatedAt: serverTimestamp() }));
    await assertSucceeds(deleteDoc(ref));
  });

  it.each(COLLECTIONS)('creates, reads and deletes their own $name', async (entry) => {
    const db = linkedContext(env, OWNER).firestore();
    const ref = doc(db, `${entry.path(OWNER)}/${entry.id}`);

    await assertSucceeds(setDoc(ref, entry.build(OWNER, entry.id)));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(getDocs(collection(db, entry.path(OWNER))));
    await assertSucceeds(deleteDoc(ref));
  });
});

describe('a user may not touch another user', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, `users/${OWNER}`), profileDoc(OWNER));
      for (const entry of COLLECTIONS) {
        await setDoc(doc(db, `${entry.path(OWNER)}/${entry.id}`), entry.build(OWNER, entry.id));
      }
    });
  });

  it("cannot read another user's profile", async () => {
    const db = linkedContext(env, OTHER).firestore();
    await assertFails(getDoc(doc(db, `users/${OWNER}`)));
  });

  it("cannot overwrite another user's profile", async () => {
    const db = linkedContext(env, OTHER).firestore();
    await assertFails(setDoc(doc(db, `users/${OWNER}`), profileDoc(OWNER, { theme: 'light' })));
  });

  it("cannot delete another user's profile", async () => {
    const db = linkedContext(env, OTHER).firestore();
    await assertFails(deleteDoc(doc(db, `users/${OWNER}`)));
  });

  it.each(COLLECTIONS)("cannot read another user's $name document", async (entry) => {
    const db = linkedContext(env, OTHER).firestore();
    await assertFails(getDoc(doc(db, `${entry.path(OWNER)}/${entry.id}`)));
  });

  it.each(COLLECTIONS)("cannot list another user's $name", async (entry) => {
    const db = linkedContext(env, OTHER).firestore();
    await assertFails(getDocs(collection(db, entry.path(OWNER))));
  });

  it.each(COLLECTIONS)("cannot write into another user's $name", async (entry) => {
    const db = linkedContext(env, OTHER).firestore();
    // Both shapes: a document claiming the victim's uid, and one claiming the
    // attacker's own. Neither may land under a path the attacker does not own.
    await assertFails(
      setDoc(doc(db, `${entry.path(OWNER)}/intruder`), entry.build(OWNER, 'intruder')),
    );
    await assertFails(
      setDoc(doc(db, `${entry.path(OWNER)}/intruder`), entry.build(OTHER, 'intruder')),
    );
  });

  it.each(COLLECTIONS)("cannot delete another user's $name document", async (entry) => {
    const db = linkedContext(env, OTHER).firestore();
    await assertFails(deleteDoc(doc(db, `${entry.path(OWNER)}/${entry.id}`)));
  });

  it('a coach with no grant is just another user', async () => {
    const db = linkedContext(env, COACH).firestore();
    await assertFails(getDoc(doc(db, `users/${OWNER}`)));
    await assertFails(getDoc(doc(db, `users/${OWNER}/workouts/w1`)));
  });
});

describe('an unauthenticated caller gets nothing', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, `users/${OWNER}`), profileDoc(OWNER));
      await setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1'));
    });
  });

  it('cannot read', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `users/${OWNER}`)));
    await assertFails(getDoc(doc(db, `users/${OWNER}/workouts/w1`)));
    await assertFails(getDocs(collection(db, `users/${OWNER}/workouts`)));
  });

  it('cannot write', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, `users/${OWNER}`), profileDoc(OWNER)));
    await assertFails(setDoc(doc(db, `users/${OTHER}`), profileDoc(OTHER)));
  });
});

describe('there is no user directory', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, `users/${OWNER}`), profileDoc(OWNER));
      await setDoc(doc(db, `users/${OTHER}`), profileDoc(OTHER));
    });
  });

  it('a signed-in user cannot enumerate /users, even to find themselves', async () => {
    // ADR-0017: no discovery. Listing is denied outright rather than filtered,
    // because a filtered listing is still a way to test whether a uid exists.
    const db = linkedContext(env, OWNER).firestore();
    await assertFails(getDocs(collection(db, 'users')));
  });

  it('but can still read their own profile document directly', async () => {
    const db = linkedContext(env, OWNER).firestore();
    const snapshot = await assertSucceeds(getDoc(doc(db, `users/${OWNER}`)));
    expect(snapshot.exists()).toBe(true);
  });
});
