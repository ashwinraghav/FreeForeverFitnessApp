import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  A_DATE,
  AN_INSTANT,
  OTHER,
  OWNER,
  aggregateDoc,
  bodyMetricDoc,
  clientTimestamp,
  createTestEnvironment,
  exerciseDoc,
  foodDoc,
  linkedContext,
  nutritionDayDoc,
  profileDoc,
  progressPhotoDoc,
  workoutDoc,
} from './harness.js';

/**
 * What a write is allowed to say about itself.
 *
 * These are the rules that stop a document from lying: about whose it is, about when
 * it was written, about what fields it has, and about what values those fields hold.
 * Each test changes exactly one thing away from a payload the previous suite proved
 * is accepted, so a failure here is attributable.
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

const ownerDb = () => linkedContext(env, OWNER).firestore();

describe('uid spoofing', () => {
  it('rejects a document under my own path that claims another uid', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OTHER, 'w1')),
    );
  });

  it('rejects a profile whose uid field disagrees with its path', async () => {
    const db = ownerDb();
    await assertFails(setDoc(doc(db, `users/${OWNER}`), profileDoc(OTHER, { id: OWNER })));
  });

  it('rejects an update that repoints an existing document at another uid', async () => {
    const db = ownerDb();
    await assertSucceeds(setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1')));
    await assertFails(
      updateDoc(doc(db, `users/${OWNER}/workouts/w1`), {
        uid: OTHER,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects a missing uid field entirely', async () => {
    const db = ownerDb();
    const { uid: _dropped, ...withoutUid } = workoutDoc(OWNER, 'w1');
    await assertFails(setDoc(doc(db, `users/${OWNER}/workouts/w1`), withoutUid));
  });
});

describe('server timestamps', () => {
  it('rejects a client-chosen createdAt', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(
        doc(db, `users/${OWNER}/workouts/w1`),
        workoutDoc(OWNER, 'w1', { createdAt: clientTimestamp() }),
      ),
    );
  });

  it('rejects a client-chosen updatedAt', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(
        doc(db, `users/${OWNER}/workouts/w1`),
        workoutDoc(OWNER, 'w1', { updatedAt: clientTimestamp() }),
      ),
    );
  });

  it('rejects a write with no updatedAt at all', async () => {
    const db = ownerDb();
    const { updatedAt: _dropped, ...withoutUpdatedAt } = workoutDoc(OWNER, 'w1');
    await assertFails(setDoc(doc(db, `users/${OWNER}/workouts/w1`), withoutUpdatedAt));
  });

  it('rejects an update that rewrites createdAt', async () => {
    const db = ownerDb();
    await assertSucceeds(setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1')));
    await assertFails(
      updateDoc(doc(db, `users/${OWNER}/workouts/w1`), {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects an update that carries a client-chosen updatedAt', async () => {
    const db = ownerDb();
    await assertSucceeds(setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1')));
    await assertFails(
      updateDoc(doc(db, `users/${OWNER}/workouts/w1`), {
        status: 'completed',
        endedAt: AN_INSTANT + 3_600_000,
        updatedAt: clientTimestamp(),
      }),
    );
  });

  it('rejects an update that leaves updatedAt where it was', async () => {
    // Otherwise a client could edit a document without moving it in the sync order,
    // and another device would never learn the edit happened.
    const db = ownerDb();
    await assertSucceeds(setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1')));
    await assertFails(updateDoc(doc(db, `users/${OWNER}/workouts/w1`), { status: 'discarded' }));
  });

  it('accepts an update that only advances updatedAt', async () => {
    const db = ownerDb();
    await assertSucceeds(setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1')));
    await assertSucceeds(
      updateDoc(doc(db, `users/${OWNER}/workouts/w1`), {
        status: 'completed',
        endedAt: AN_INSTANT + 3_600_000,
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe('schema version', () => {
  it('rejects a version above what these rules understand', async () => {
    const db = ownerDb();
    await assertFails(setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1', { sv: 2 })));
  });

  it('rejects a version of zero, a float, or a string', async () => {
    const db = ownerDb();
    for (const sv of [0, 1.5, '1']) {
      await assertFails(
        setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1', { sv })),
      );
    }
  });
});

describe('document id agreement', () => {
  it('rejects a document whose id field disagrees with its path', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'somethingElse')),
    );
  });

  it('rejects a day document whose id is not a date', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/nutritionDays/tuesday`), nutritionDayDoc(OWNER, 'tuesday')),
    );
  });

  it('rejects a document id that is digit-shaped but not a date', async () => {
    // Found by an adversarial probe against an earlier, shape-only regex.
    const db = ownerDb();
    for (const date of ['1234-56-78', '0000-00-00', '9999-99-99', '2026-00-10', '2026-01-32']) {
      await assertFails(
        setDoc(doc(db, `users/${OWNER}/bodyMetrics/${date}`), bodyMetricDoc(OWNER, date)),
      );
      await assertFails(
        setDoc(doc(db, `users/${OWNER}/nutritionDays/${date}`), nutritionDayDoc(OWNER, date)),
      );
    }
  });

  it('accepts the last day of a long month', async () => {
    const db = ownerDb();
    await assertSucceeds(
      setDoc(doc(db, `users/${OWNER}/bodyMetrics/2026-01-31`), bodyMetricDoc(OWNER, '2026-01-31')),
    );
  });

  it('rejects a day document whose localDate disagrees with its id', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(
        doc(db, `users/${OWNER}/nutritionDays/${A_DATE}`),
        nutritionDayDoc(OWNER, A_DATE, { localDate: '2026-01-01' }),
      ),
    );
  });
});

describe('unknown fields', () => {
  it('rejects a field this schema does not define', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(
        doc(db, `users/${OWNER}/workouts/w1`),
        workoutDoc(OWNER, 'w1', { isAdmin: true }),
      ),
    );
  });

  it('rejects a smuggled payload on the profile', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}`), profileDoc(OWNER, { apiKey: 'sk-not-here-thanks' })),
    );
  });

  it('rejects an update that adds an undefined field', async () => {
    const db = ownerDb();
    await assertSucceeds(setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1')));
    await assertFails(
      updateDoc(doc(db, `users/${OWNER}/workouts/w1`), {
        somethingNew: 1,
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe('required fields', () => {
  it('rejects a workout with no status', async () => {
    const db = ownerDb();
    const { status: _dropped, ...incomplete } = workoutDoc(OWNER, 'w1');
    await assertFails(setDoc(doc(db, `users/${OWNER}/workouts/w1`), incomplete));
  });

  it('rejects a workout with no totals', async () => {
    const db = ownerDb();
    const { totals: _dropped, ...incomplete } = workoutDoc(OWNER, 'w1');
    await assertFails(setDoc(doc(db, `users/${OWNER}/workouts/w1`), incomplete));
  });

  it('rejects a profile with no consent block', async () => {
    const db = ownerDb();
    const { consent: _dropped, ...incomplete } = profileDoc(OWNER);
    await assertFails(setDoc(doc(db, `users/${OWNER}`), incomplete));
  });
});

describe('enumerated fields', () => {
  const cases: readonly { field: string; value: unknown }[] = [
    { field: 'status', value: 'in-progress' },
    { field: 'status', value: 'deleted' },
    { field: 'status', value: '' },
    { field: 'status', value: 1 },
    { field: 'status', value: null },
  ];

  it.each(cases)('rejects workout.$field = $value', async ({ field, value }) => {
    const db = ownerDb();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1', { [field]: value })),
    );
  });

  it('rejects an unknown theme on the profile', async () => {
    const db = ownerDb();
    await assertFails(setDoc(doc(db, `users/${OWNER}`), profileDoc(OWNER, { theme: 'blueprint' })));
  });

  it('rejects an unknown equipment value on a custom exercise', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/exercises/e1`), exerciseDoc(OWNER, 'e1', { equipment: 'rope' })),
    );
  });

  it('rejects a custom exercise that claims to be catalogue data', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(
        doc(db, `users/${OWNER}/exercises/e1`),
        exerciseDoc(OWNER, 'e1', { source: 'catalogue' }),
      ),
    );
  });

  it('rejects an unknown pose on a progress photo', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(
        doc(db, `users/${OWNER}/progressPhotos/p1`),
        progressPhotoDoc(OWNER, 'p1', { pose: 'whatever' }),
      ),
    );
  });

  it('rejects an aggregate id that is not one of ours', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/aggregates/everything`), aggregateDoc(OWNER, 'everything')),
    );
  });

  it('accepts every aggregate id that is', async () => {
    const db = ownerDb();
    for (const id of [
      'training_volume',
      'exercise_progress',
      'personal_records',
      'adherence',
      'nutrition',
    ]) {
      await assertSucceeds(
        setDoc(doc(db, `users/${OWNER}/aggregates/${id}`), aggregateDoc(OWNER, id)),
      );
    }
  });
});

describe('bounds and types', () => {
  it('rejects a workout with more exercises than a session can hold', async () => {
    const db = ownerDb();
    const tooMany = Array.from({ length: 41 }, () => ({ id: 'x', sortKey: 'V', sets: [] }));
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1', { exercises: tooMany })),
    );
  });

  it('rejects a set count beyond the cap, however the array is shaped', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(
        doc(db, `users/${OWNER}/workouts/w1`),
        workoutDoc(OWNER, 'w1', {
          totals: { ...workoutDoc(OWNER, 'w1').totals, setCount: 100_000 },
        }),
      ),
    );
  });

  it('rejects a title longer than the field allows', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1', { title: 'x'.repeat(121) })),
    );
  });

  it('rejects an empty title', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1', { title: '' })),
    );
  });

  it('rejects a note used as a payload', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1', { note: 'x'.repeat(281) })),
    );
  });

  it('rejects a startedAt outside any plausible clock', async () => {
    const db = ownerDb();
    for (const startedAt of [0, 1, 9_999_999_999_999_9]) {
      await assertFails(
        setDoc(doc(db, `users/${OWNER}/workouts/w1`), workoutDoc(OWNER, 'w1', { startedAt })),
      );
    }
  });

  it('rejects a timezone offset outside the range any zone actually uses', async () => {
    const db = ownerDb();
    for (const tzOffsetMinutes of [-721, 841, 1.5]) {
      await assertFails(
        setDoc(
          doc(db, `users/${OWNER}/workouts/w1`),
          workoutDoc(OWNER, 'w1', { tzOffsetMinutes }),
        ),
      );
    }
  });

  it('rejects a malformed barcode on a custom food', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/foods/f1`), foodDoc(OWNER, 'f1', { barcode: 'not-a-barcode' })),
    );
    await assertSucceeds(
      setDoc(doc(db, `users/${OWNER}/foods/f2`), foodDoc(OWNER, 'f2', { barcode: '5000112637922' })),
    );
  });

  it('rejects a body metric with a negative bodyweight', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(
        doc(db, `users/${OWNER}/bodyMetrics/${A_DATE}`),
        bodyMetricDoc(OWNER, A_DATE, { weightKg: -1 }),
      ),
    );
  });
});

describe('progress photo storage paths', () => {
  it("rejects a photo pointing at another user's storage prefix", async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(
        doc(db, `users/${OWNER}/progressPhotos/p1`),
        progressPhotoDoc(OWNER, 'p1', { storagePath: `users/${OTHER}/photos/p1.jpg` }),
      ),
    );
  });

  it('rejects a traversal dressed up as a prefix', async () => {
    const db = ownerDb();
    for (const storagePath of [
      `users/${OWNER}`,
      `users/${OWNER}/`,
      `users/${OWNER}x/photos/p1.jpg`,
      `../users/${OWNER}/photos/p1.jpg`,
      'https://example.test/p1.jpg',
    ]) {
      await assertFails(
        setDoc(
          doc(db, `users/${OWNER}/progressPhotos/p1`),
          progressPhotoDoc(OWNER, 'p1', { storagePath }),
        ),
      );
    }
  });

  it('accepts a path under the owner’s own prefix', async () => {
    const db = ownerDb();
    await assertSucceeds(
      setDoc(doc(db, `users/${OWNER}/progressPhotos/p1`), progressPhotoDoc(OWNER, 'p1')),
    );
  });
});

describe('aggregate documents', () => {
  it('rejects a client-chosen computedAt', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(
        doc(db, `users/${OWNER}/aggregates/adherence`),
        aggregateDoc(OWNER, 'adherence', { computedAt: clientTimestamp() }),
      ),
    );
  });

  it('rejects a version that is not a positive integer', async () => {
    const db = ownerDb();
    for (const version of [0, -1, '1', 1.5]) {
      await assertFails(
        setDoc(
          doc(db, `users/${OWNER}/aggregates/adherence`),
          aggregateDoc(OWNER, 'adherence', { version }),
        ),
      );
    }
  });
});
