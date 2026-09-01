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

  /*
   * The network bans above apply to EVERY file here, photos included — nothing in
   * this directory may upload. Synchrony is narrower: it is a property of the
   * aggregate read path, which ADR-0005 requires to answer from local state
   * without awaiting anything, so the Progress tab cannot spin.
   *
   * Allowed by exception, and each exception says why — the same shape as the
   * collapse exemption in the design system's hit-target suite.
   */
  const MAY_AWAIT: Record<string, string> = {
    '../photoStore.ts':
      'Binary blobs cannot live in localStorage and IndexedDB has no synchronous API. `list()` — the read the gallery renders from — IS synchronous, off localStorage metadata; only opening pixels and writing await.',
  };

  it('keeps the read path synchronous', () => {
    const offenders = entries
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([path]) => !(path in MAY_AWAIT))
      .filter(([, source]) => /\basync\b|\bawait\b/.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('every await exception still exists and is justified', () => {
    // Otherwise the allowlist quietly becomes a list of files nobody deleted.
    for (const [path, why] of Object.entries(MAY_AWAIT)) {
      expect(entries.some(([p]) => p === path), `${path} is gone`).toBe(true);
      expect(why.length).toBeGreaterThan(40);
    }
  });

  it('the exempt file still keeps its own read synchronous', () => {
    const photoStore = entries.find(([path]) => path === '../photoStore.ts')?.[1] ?? '';
    // The exemption is for blobs, not a licence to make list() async — that is
    // the one method the gallery renders from on every subscribe.
    expect(photoStore).toMatch(/list:\s*\(\)\s*=>/u);
    expect(photoStore).not.toMatch(/async\s+list\b/u);
  });
});
