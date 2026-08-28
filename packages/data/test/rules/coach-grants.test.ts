import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  A_DATE,
  COACH,
  OTHER,
  OWNER,
  bodyMetricDoc,
  createTestEnvironment,
  grantDoc,
  linkedContext,
  nutritionDayDoc,
  profileDoc,
  progressPhotoDoc,
  routineDoc,
  workoutDoc,
} from './harness.js';

/**
 * Coach access — the only path by which one account reads another's data.
 *
 * This is where the rules are most likely to be wrong, so this file tries hardest to
 * break them: forged grants, grants pointing at the wrong pair, grants that were
 * revoked, grants that expired, grants for a scope the coach does not have, and
 * coaches trying to write anything at all.
 */

let env: RulesTestEnvironment;

const GRANT_ID = `${OWNER}__${COACH}`;

beforeAll(async () => {
  env = await createTestEnvironment();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `users/${OWNER}`), profileDoc(OWNER));
    await setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1'));
    await setDoc(doc(db, `users/${OWNER}/routines/r1`), routineDoc(OWNER, 'r1'));
    await setDoc(doc(db, `users/${OWNER}/nutritionDays/${A_DATE}`), nutritionDayDoc(OWNER, A_DATE));
    await setDoc(doc(db, `users/${OWNER}/bodyMetrics/${A_DATE}`), bodyMetricDoc(OWNER, A_DATE));
    await setDoc(doc(db, `users/${OWNER}/progressPhotos/p1`), progressPhotoDoc(OWNER, 'p1'));
  });
});

async function seedGrant(overrides: Record<string, unknown> = {}, id = GRANT_ID): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `coachGrants/${id}`), {
      ...grantDoc(OWNER, COACH),
      ...overrides,
    });
  });
}

const coachDb = () => linkedContext(env, COACH).firestore();
const ownerDb = () => linkedContext(env, OWNER).firestore();

describe('who may issue a grant', () => {
  it('the owner may, naming themselves', async () => {
    await assertSucceeds(
      setDoc(doc(ownerDb(), `coachGrants/${GRANT_ID}`), grantDoc(OWNER, COACH)),
    );
  });

  it('the coach may not write themselves one', async () => {
    await assertFails(
      setDoc(doc(coachDb(), `coachGrants/${GRANT_ID}`), grantDoc(OWNER, COACH)),
    );
  });

  it('a third party may not write one for two other people', async () => {
    const db = linkedContext(env, OTHER).firestore();
    await assertFails(setDoc(doc(db, `coachGrants/${GRANT_ID}`), grantDoc(OWNER, COACH)));
  });

  it('the document id must be derived from the two uids', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), 'coachGrants/whatever'), grantDoc(OWNER, COACH, { id: 'whatever' })),
    );
    await assertFails(
      setDoc(
        doc(ownerDb(), `coachGrants/${OWNER}__${OTHER}`),
        grantDoc(OWNER, COACH, { id: `${OWNER}__${OTHER}` }),
      ),
    );
  });

  it('a grant may not name the same user on both sides', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), `coachGrants/${OWNER}__${OWNER}`), grantDoc(OWNER, OWNER)),
    );
  });

  it('a grant must carry at least one scope, and only scopes we defined', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), `coachGrants/${GRANT_ID}`), grantDoc(OWNER, COACH, { scopes: [] })),
    );
    await assertFails(
      setDoc(
        doc(ownerDb(), `coachGrants/${GRANT_ID}`),
        grantDoc(OWNER, COACH, { scopes: ['training', 'everything'] }),
      ),
    );
  });

  it('a grant may not be created already revoked, nor with a client-set createdAt', async () => {
    await assertFails(
      setDoc(
        doc(ownerDb(), `coachGrants/${GRANT_ID}`),
        grantDoc(OWNER, COACH, { status: 'revoked', revokedAt: serverTimestamp() }),
      ),
    );
    await assertFails(
      setDoc(
        doc(ownerDb(), `coachGrants/${GRANT_ID}`),
        grantDoc(OWNER, COACH, { createdAt: Timestamp.fromMillis(1_700_000_000_000) }),
      ),
    );
  });
});

describe('what a grant opens', () => {
  it('a training grant lets the coach read training data', async () => {
    await seedGrant({ scopes: ['profile', 'training'] });
    const db = coachDb();
    await assertSucceeds(getDoc(doc(db, `users/${OWNER}`)));
    await assertSucceeds(getDoc(doc(db, `users/${OWNER}/workouts/w1`)));
    await assertSucceeds(getDocs(collection(db, `users/${OWNER}/workouts`)));
    await assertSucceeds(getDoc(doc(db, `users/${OWNER}/routines/r1`)));
  });

  it('and nothing else', async () => {
    await seedGrant({ scopes: ['profile', 'training'] });
    const db = coachDb();
    await assertFails(getDoc(doc(db, `users/${OWNER}/nutritionDays/${A_DATE}`)));
    await assertFails(getDoc(doc(db, `users/${OWNER}/bodyMetrics/${A_DATE}`)));
    await assertFails(getDoc(doc(db, `users/${OWNER}/progressPhotos/p1`)));
  });

  it('a nutrition grant opens nutrition and not training', async () => {
    await seedGrant({ scopes: ['nutrition'] });
    const db = coachDb();
    await assertSucceeds(getDoc(doc(db, `users/${OWNER}/nutritionDays/${A_DATE}`)));
    await assertFails(getDoc(doc(db, `users/${OWNER}/workouts/w1`)));
    await assertFails(getDoc(doc(db, `users/${OWNER}`)));
  });

  it('photos are never implied — they need their own scope', async () => {
    await seedGrant({ scopes: ['profile', 'training', 'nutrition', 'body'] });
    await assertFails(getDoc(doc(coachDb(), `users/${OWNER}/progressPhotos/p1`)));

    await seedGrant({ scopes: ['photos'] });
    await assertSucceeds(getDoc(doc(coachDb(), `users/${OWNER}/progressPhotos/p1`)));
  });

  it('a grant never confers write access', async () => {
    await seedGrant({ scopes: ['profile', 'training', 'nutrition', 'body', 'photos'] });
    const db = coachDb();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/workouts/w2`), workoutDoc(OWNER, 'w2')),
    );
    await assertFails(
      updateDoc(doc(db, `users/${OWNER}/workouts/w1`), {
        title: 'edited by the coach',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(deleteDoc(doc(db, `users/${OWNER}/workouts/w1`)));
    await assertFails(
      setDoc(doc(db, `users/${OWNER}`), profileDoc(OWNER, { theme: 'light' }), { merge: true }),
    );
  });
});

describe('aggregates are fetched by id, not listed', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (const id of ['training_volume', 'personal_records', 'nutrition']) {
        await setDoc(doc(db, `users/${OWNER}/aggregates/${id}`), {
          sv: 1,
          uid: OWNER,
          id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          version: 1,
          sequenceByKind: {},
          computedAt: serverTimestamp(),
          state: {},
        });
      }
    });
  });

  it('a training coach reads the training folds and not the nutrition one', async () => {
    await seedGrant({ scopes: ['training'] });
    const db = coachDb();
    await assertSucceeds(getDoc(doc(db, `users/${OWNER}/aggregates/training_volume`)));
    await assertSucceeds(getDoc(doc(db, `users/${OWNER}/aggregates/personal_records`)));
    await assertFails(getDoc(doc(db, `users/${OWNER}/aggregates/nutrition`)));
  });

  it('a training coach cannot list the collection to get the nutrition fold anyway', async () => {
    // The listing is the interesting attack: a query returns whole documents, so a
    // rule that let it through would hand over a fold the coach has no scope for.
    await seedGrant({ scopes: ['training'] });
    await assertFails(getDocs(collection(coachDb(), `users/${OWNER}/aggregates`)));
  });

  it('a coach may list only when they hold every scope the collection spans', async () => {
    await seedGrant({ scopes: ['training', 'nutrition'] });
    const results = await assertSucceeds(getDocs(collection(coachDb(), `users/${OWNER}/aggregates`)));
    expect(results.size).toBe(3);
  });

  it('the owner lists their own folds regardless', async () => {
    const results = await assertSucceeds(getDocs(collection(ownerDb(), `users/${OWNER}/aggregates`)));
    expect(results.size).toBe(3);
  });
});

describe('a grant that does not apply', () => {
  it('does not open a third user, only the one it names', async () => {
    await seedGrant({ scopes: ['training'] });
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, `users/${OTHER}`), profileDoc(OTHER));
      await setDoc(doc(db, `users/${OTHER}/workouts/w1`), workoutDoc(OTHER, 'w1'));
    });
    await assertFails(getDoc(doc(coachDb(), `users/${OTHER}/workouts/w1`)));
  });

  it('does not work for a different coach', async () => {
    await seedGrant({ scopes: ['training'] });
    await assertFails(getDoc(doc(linkedContext(env, OTHER).firestore(), `users/${OWNER}/workouts/w1`)));
  });

  it('is ignored when its body disagrees with its id', async () => {
    // Planted with rules disabled, as if a bug or an admin script had written it.
    // The rule re-checks both uids against the document body rather than trusting
    // the path it resolved, so a mis-keyed grant opens nothing.
    await seedGrant({ ownerUid: OTHER, coachUid: COACH, id: GRANT_ID });
    await assertFails(getDoc(doc(coachDb(), `users/${OWNER}/workouts/w1`)));
  });

  it('is ignored when it names a different coach in its body', async () => {
    await seedGrant({ coachUid: OTHER });
    await assertFails(getDoc(doc(coachDb(), `users/${OWNER}/workouts/w1`)));
  });
});

describe('revocation', () => {
  it('takes effect immediately when the status flips', async () => {
    await seedGrant({ scopes: ['training'] });
    await assertSucceeds(getDoc(doc(coachDb(), `users/${OWNER}/workouts/w1`)));

    await assertSucceeds(
      updateDoc(doc(ownerDb(), `coachGrants/${GRANT_ID}`), {
        status: 'revoked',
        revokedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );

    await assertFails(getDoc(doc(coachDb(), `users/${OWNER}/workouts/w1`)));
  });

  it('takes effect when the grant is deleted', async () => {
    await seedGrant({ scopes: ['training'] });
    await assertSucceeds(getDoc(doc(coachDb(), `users/${OWNER}/workouts/w1`)));
    await assertSucceeds(deleteDoc(doc(ownerDb(), `coachGrants/${GRANT_ID}`)));
    await assertFails(getDoc(doc(coachDb(), `users/${OWNER}/workouts/w1`)));
  });

  it('cannot be undone by the coach', async () => {
    await seedGrant({
      scopes: ['training'],
      status: 'revoked',
      revokedAt: Timestamp.fromMillis(1_700_000_000_000),
    });
    const db = coachDb();
    await assertFails(getDoc(doc(db, `users/${OWNER}/workouts/w1`)));
    await assertFails(
      updateDoc(doc(db, `coachGrants/${GRANT_ID}`), {
        status: 'active',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(getDoc(doc(db, `users/${OWNER}/workouts/w1`)));
  });

  it('cannot be widened by the coach', async () => {
    await seedGrant({ scopes: ['training'] });
    await assertFails(
      updateDoc(doc(coachDb(), `coachGrants/${GRANT_ID}`), {
        scopes: ['profile', 'training', 'nutrition', 'body', 'photos'],
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(getDoc(doc(coachDb(), `users/${OWNER}/progressPhotos/p1`)));
  });

  it('happens on its own when the grant expires', async () => {
    await seedGrant({ scopes: ['training'], expiresAt: Timestamp.fromMillis(Date.now() - 60_000) });
    await assertFails(getDoc(doc(coachDb(), `users/${OWNER}/workouts/w1`)));
  });

  it('does not happen early — a future expiry still works', async () => {
    await seedGrant({
      scopes: ['training'],
      expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000),
    });
    await assertSucceeds(getDoc(doc(coachDb(), `users/${OWNER}/workouts/w1`)));
  });

  it('the coach may always walk away by deleting the grant', async () => {
    await seedGrant({ scopes: ['training'] });
    await assertSucceeds(deleteDoc(doc(coachDb(), `coachGrants/${GRANT_ID}`)));
    await assertFails(getDoc(doc(coachDb(), `users/${OWNER}/workouts/w1`)));
  });

  it('is stamped by the server, not by the client', async () => {
    await seedGrant({ scopes: ['training'] });
    await assertFails(
      updateDoc(doc(ownerDb(), `coachGrants/${GRANT_ID}`), {
        status: 'revoked',
        revokedAt: Timestamp.fromMillis(1_700_000_000_000),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('and the stamp survives a later edit to the dead grant', async () => {
    await seedGrant({ scopes: ['training'] });
    const grantRef = doc(ownerDb(), `coachGrants/${GRANT_ID}`);
    await assertSucceeds(
      updateDoc(grantRef, {
        status: 'revoked',
        revokedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    const stamped = await assertSucceeds(getDoc(grantRef));
    await assertSucceeds(updateDoc(grantRef, { note: 'ended the block', updatedAt: serverTimestamp() }));
    const after = await assertSucceeds(getDoc(grantRef));
    expect(after.data()?.['revokedAt']).toEqual(stamped.data()?.['revokedAt']);
  });

  it('cannot be backdated by rewriting it on a later edit', async () => {
    await seedGrant({ scopes: ['training'] });
    const grantRef = doc(ownerDb(), `coachGrants/${GRANT_ID}`);
    await assertSucceeds(
      updateDoc(grantRef, {
        status: 'revoked',
        revokedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(grantRef, {
        revokedAt: Timestamp.fromMillis(1_700_000_000_000),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('a revoked grant must say when it was revoked', async () => {
    await seedGrant({ scopes: ['training'] });
    await assertFails(
      updateDoc(doc(ownerDb(), `coachGrants/${GRANT_ID}`), {
        status: 'revoked',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('a grant may not be repointed at a different coach', async () => {
    await seedGrant({ scopes: ['training'] });
    await assertFails(
      updateDoc(doc(ownerDb(), `coachGrants/${GRANT_ID}`), {
        coachUid: OTHER,
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe('reading the grants themselves', () => {
  beforeEach(async () => {
    await seedGrant({ scopes: ['training'] });
    // A grant between two other people, so an unfiltered listing has something to
    // trip over.
    await seedGrant(
      { ownerUid: OTHER, coachUid: 'thirdPartyUidDDDDDDDDDDDDDDD', id: `${OTHER}__thirdPartyUidDDDDDDDDDDDDDDD` },
      `${OTHER}__thirdPartyUidDDDDDDDDDDDDDDD`,
    );
  });

  it('both parties can read the grant between them', async () => {
    expect((await assertSucceeds(getDoc(doc(ownerDb(), `coachGrants/${GRANT_ID}`)))).exists()).toBe(true);
    expect((await assertSucceeds(getDoc(doc(coachDb(), `coachGrants/${GRANT_ID}`)))).exists()).toBe(true);
  });

  it('an unrelated user cannot', async () => {
    const db = linkedContext(env, 'nosyUidEEEEEEEEEEEEEEEEEEEEE').firestore();
    await assertFails(getDoc(doc(db, `coachGrants/${GRANT_ID}`)));
  });

  it('a coach can list the clients who granted them access', async () => {
    const db = coachDb();
    const results = await assertSucceeds(
      getDocs(query(collection(db, 'coachGrants'), where('coachUid', '==', COACH))),
    );
    expect(results.size).toBe(1);
  });

  it('an owner can list the coaches they granted', async () => {
    const db = ownerDb();
    const results = await assertSucceeds(
      getDocs(query(collection(db, 'coachGrants'), where('ownerUid', '==', OWNER))),
    );
    expect(results.size).toBe(1);
  });

  it('nobody can list every grant in the system', async () => {
    await assertFails(getDocs(collection(coachDb(), 'coachGrants')));
    await assertFails(
      getDocs(query(collection(coachDb(), 'coachGrants'), where('ownerUid', '==', OTHER))),
    );
  });

  it('an unauthenticated caller cannot read any grant', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `coachGrants/${GRANT_ID}`)));
    await assertFails(getDocs(collection(db, 'coachGrants')));
  });
});
