import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OWNER, RULES_SOURCE, createTestEnvironment, linkedContext } from './harness.js';

/**
 * Everything not explicitly allowed.
 *
 * There is no catch-all under `/users/{uid}`, which means adding a collection is a
 * rules change with tests rather than something that quietly starts working. These
 * assertions are what make that true rather than merely intended.
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

const UNDECLARED_PATHS = [
  'admin/config',
  'system/flags',
  'quotas/global',
  'aiUsage/today',
  `users/${OWNER}/secrets/apiKey`,
  `users/${OWNER}/notes/n1`,
  `users/${OWNER}/workouts/w1/sets/s1`,
  `users/${OWNER}/aggregates/adherence/detail/d1`,
];

describe('undeclared collections are inaccessible', () => {
  it.each(UNDECLARED_PATHS)('denies reads at %s, even to the owner', async (path) => {
    const db = linkedContext(env, OWNER).firestore();
    await assertFails(getDoc(doc(db, path)));
  });

  it.each(UNDECLARED_PATHS)('denies writes at %s, even to the owner', async (path) => {
    const db = linkedContext(env, OWNER).firestore();
    await assertFails(setDoc(doc(db, path), { anything: true }));
  });

  it('denies listing an undeclared collection', async () => {
    const db = linkedContext(env, OWNER).firestore();
    await assertFails(getDocs(collection(db, `users/${OWNER}/secrets`)));
    await assertFails(getDocs(collection(db, 'admin')));
  });
});

describe('the rules file itself', () => {
  it('ends in an explicit default deny', async () => {
    // Allow rules are additive, so this statement takes nothing away. It is here so
    // that a reader of a public rules file can see the posture without deriving it,
    // and this assertion is here so it cannot quietly go missing.
    expect(RULES_SOURCE).toMatch(/match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  });

  it('contains no unconditional allow', async () => {
    expect(RULES_SOURCE).not.toMatch(/allow\s+[a-z, ]+:\s*if\s+true\s*;/);
  });

  it('grants no read to an unauthenticated caller anywhere', async () => {
    // Every allow in the file either requires isOwner/canRead/isSignedIn, or is a
    // literal `if false`. Anything else would be a public read (ADR-0017).
    const allowLines = RULES_SOURCE.split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('allow '));
    expect(allowLines.length).toBeGreaterThan(0);
    for (const line of allowLines) {
      const guarded =
        /if (false|isOwner|canRead|isSignedIn)/.test(line) || line.endsWith(': if isSignedIn()');
      expect(guarded, `unguarded allow: ${line}`).toBe(true);
    }
  });
});
