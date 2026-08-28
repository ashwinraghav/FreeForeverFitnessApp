import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  A_DATE,
  OTHER,
  OWNER,
  RULES_SOURCE,
  anonymousContext,
  bodyMetricDoc,
  createTestEnvironment,
  linkedContext,
  nutritionDayDoc,
  profileDoc,
  workoutDoc,
} from './harness.js';

/**
 * ADR-0009: an anonymous account is not a second-class account.
 *
 * The promise is that a user who opens the app and logs a set in ten seconds has the
 * same rights over their data as a user who signed up, and loses nothing at the
 * moment they link an account. That is only true if no rule ever inspects the
 * sign-in provider — so this suite runs the same battery under both token types and
 * asserts the outcomes are identical, and then checks the rules source directly for
 * the thing that would break it.
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

const CONTEXTS = [
  { label: 'anonymous', make: anonymousContext },
  { label: 'linked', make: linkedContext },
] as const;

describe.each(CONTEXTS)('$label account', ({ make }) => {
  it('creates and reads its own profile', async () => {
    const db = make(env, OWNER).firestore();
    await assertSucceeds(setDoc(doc(db, `users/${OWNER}`), profileDoc(OWNER)));
    const snapshot = await assertSucceeds(getDoc(doc(db, `users/${OWNER}`)));
    expect(snapshot.exists()).toBe(true);
  });

  it('logs a workout', async () => {
    const db = make(env, OWNER).firestore();
    await assertSucceeds(setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1')));
    await assertSucceeds(getDocs(collection(db, `users/${OWNER}/workouts`)));
  });

  it('logs nutrition and body metrics', async () => {
    const db = make(env, OWNER).firestore();
    await assertSucceeds(
      setDoc(doc(db, `users/${OWNER}/nutritionDays/${A_DATE}`), nutritionDayDoc(OWNER, A_DATE)),
    );
    await assertSucceeds(
      setDoc(doc(db, `users/${OWNER}/bodyMetrics/${A_DATE}`), bodyMetricDoc(OWNER, A_DATE)),
    );
  });

  it('deletes its own data', async () => {
    const db = make(env, OWNER).firestore();
    await assertSucceeds(setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1')));
    await assertSucceeds(deleteDoc(doc(db, `users/${OWNER}/workouts/w1`)));
  });

  it('is refused another user, exactly as the other kind of account is', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `users/${OTHER}`), profileDoc(OTHER));
    });
    const db = make(env, OWNER).firestore();
    await assertFails(getDoc(doc(db, `users/${OTHER}`)));
    await assertFails(setDoc(doc(db, `users/${OTHER}/workouts/w1`), workoutDoc(OTHER, 'w1')));
  });
});

describe('linking an account changes nothing', () => {
  it('data written anonymously stays readable and writable after linking', async () => {
    // Linking upgrades the account in place and keeps the uid, so the same uid
    // arriving with a different provider must see exactly the same data.
    const anonDb = anonymousContext(env, OWNER).firestore();
    await assertSucceeds(setDoc(doc(anonDb, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1')));

    const linkedDb = linkedContext(env, OWNER).firestore();
    const snapshot = await assertSucceeds(getDoc(doc(linkedDb, `users/${OWNER}/workouts/w1`)));
    expect(snapshot.exists()).toBe(true);
    await assertSucceeds(
      setDoc(doc(linkedDb, `users/${OWNER}/workouts/w2`), workoutDoc(OWNER, 'w2')),
    );
  });
});

describe('the rules never look at how you signed in', () => {
  it('mentions no provider, tier or verification condition', async () => {
    // A regression guard with teeth: the parity assertions above would still pass if
    // someone added a provider check to a collection this file does not exercise.
    // This one fails the moment the concept enters the file at all.
    for (const forbidden of [
      'sign_in_provider',
      'email_verified',
      'provider_id',
      'isAnonymous',
      'firebase.identities',
    ]) {
      expect(RULES_SOURCE.includes(forbidden), `firestore.rules must not reference ${forbidden}`).toBe(
        false,
      );
    }
  });
});
