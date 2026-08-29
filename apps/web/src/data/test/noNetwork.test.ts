import { describe, expect, it } from 'vitest';

/**
 * ADR-0005, enforced over the one directory the insights feature's own guard cannot
 * see.
 *
 * `features/insights/test/no-firestore.test.ts` globs `../**` from inside that
 * feature, so it covers the screens and stops at the feature boundary. Everything in
 * here sits outside it — and this is now the only place in the app where an aggregate
 * is produced, which makes it the only place a Firestore query could plausibly be
 * added to "just fetch the missing history". The guard has to follow the data.
 *
 * The sync-layer import is deliberately *not* banned here, unlike in the feature:
 * this directory exists precisely to call the sync team's reducers. What is banned is
 * the Firebase SDK, any query surface, and any asynchrony on the read path — `read()`
 * is synchronous by contract, and an `await` is where a round trip would hide.
 */

const sources = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const SELF = 'noNetwork.test.ts';
const entries = Object.entries(sources).filter(([path]) => !path.endsWith(SELF));

const BANS: readonly { name: string; pattern: RegExp; why: string }[] = [
  {
    name: 'firebase import',
    pattern: /from\s+['"](firebase|@firebase)[/'"]/,
    why: 'aggregates are folded locally; the SDK has no business on this path',
  },
  {
    name: 'firestore import',
    pattern: /from\s+['"][^'"]*firestore[^'"]*['"]/i,
    why: 'no Firestore module, direct or re-exported',
  },
  {
    name: 'query builder',
    pattern: /\b(getDocs|getDoc|onSnapshot|collectionGroup|documentId)\s*\(/,
    why: 'a Firestore read, however it is spelled',
  },
  { name: 'fetch', pattern: /\bfetch\s*\(/, why: 'the Progress tab is offline by construction' },
];

describe('the aggregate adapter never goes to the network', () => {
  it('has files to check, so a glob that resolved to nothing fails loudly', () => {
    // The trap this repo has already been caught by twice: a negative assertion that
    // passes because it examined nothing at all.
    expect(entries.length).toBeGreaterThan(4);
    expect(entries.map(([path]) => path).join(' ')).toContain('localAggregates.ts');
  });

  for (const ban of BANS) {
    it(`contains no ${ban.name} — ${ban.why}`, () => {
      const offenders = entries
        .filter(([, source]) => ban.pattern.test(source))
        .map(([path]) => path);
      expect(offenders).toEqual([]);
    });
  }

  it('keeps the read path synchronous', () => {
    const offenders = entries
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, source]) => /\basync\b|\bawait\b/.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
