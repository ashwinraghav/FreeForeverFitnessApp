import { describe, expect, it } from 'vitest';

/**
 * The rule that defines this package, enforced rather than remembered.
 *
 * ADR-0005: "A Firestore query inside `features/insights` is a build failure, not a
 * code review comment." A comment saying so is not a build failure. This is.
 *
 * Firestore bills per document read. A chart that queries on render bills forever and
 * the bill grows with success — the unbounded per-user cost constitution rule 2
 * forbids — and the failure is silent, because a chart fed by a query looks exactly
 * like a chart fed by an aggregate right up until the invoice.
 *
 * The whole feature tree is read as source and checked. This catches the import a
 * future maintainer adds in good faith at 2am, which no amount of documentation does.
 * Sources are pulled through `import.meta.glob` rather than `node:fs` so the test
 * needs no Node types and travels with the bundle graph it is actually guarding.
 */

const sources = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** This file names every banned symbol, so it must exempt itself. */
const SELF = 'no-firestore.test.ts';

const entries = Object.entries(sources).filter(([path]) => !path.endsWith(SELF));

interface Ban {
  readonly name: string;
  readonly pattern: RegExp;
  readonly why: string;
}

const BANS: readonly Ban[] = [
  {
    name: 'firebase import',
    pattern: /from\s+['"](firebase|@firebase)[/'"]/,
    why: 'the feature must not reach the Firebase SDK at all — data arrives through the injected port',
  },
  {
    name: 'firestore import',
    pattern: /from\s+['"][^'"]*firestore[^'"]*['"]/i,
    why: 'no Firestore module, direct or re-exported',
  },
  {
    name: 'sync-layer import',
    pattern: /from\s+['"]@freeforever\/data\/(src\/)?sync/,
    why: 'the sync layer owns the fold; insights reads the result, not the machinery',
  },
  {
    name: 'query builder',
    pattern: /\b(getDocs|getDoc|onSnapshot|collectionGroup|documentId)\s*\(/,
    why: 'a Firestore read, however it is spelled',
  },
  {
    name: 'query clause',
    pattern: /\b(where|orderBy|startAfter|startAt|endBefore|limitToLast)\s*\(\s*['"]/,
    why: 'a Firestore query clause — filtering happens in memory over the materialised aggregate',
  },
  {
    name: 'network fetch',
    pattern: /\b(fetch|XMLHttpRequest|EventSource|WebSocket)\s*\(/,
    why: 'an insights screen has nothing to fetch; every number is already local',
  },
];

describe('features/insights never reads Firestore', () => {
  it('reads its own source tree', () => {
    // A glob that silently matched nothing would make every assertion below vacuous.
    expect(entries.length).toBeGreaterThan(15);
  });

  for (const ban of BANS) {
    it(`contains no ${ban.name}`, () => {
      const offenders = entries
        .filter(([, source]) => ban.pattern.test(source))
        .map(([path]) => path);
      expect(offenders, `${ban.name}: ${ban.why}`).toEqual([]);
    });
  }

  it('exposes no data-source method that could carry a query', () => {
    const ports = entries.find(([path]) => path.endsWith('data/ports.ts'))?.[1] ?? '';
    expect(ports).toContain('read(): InsightsSnapshot');
    // `read()` taking no arguments is the structural half of the rule: there is no
    // id, range or predicate a caller could pass that an implementer could later
    // satisfy over the network.
    expect(ports).not.toMatch(/read\(\s*[A-Za-z]/);
    // And nothing on the port is async — an await is where a round trip would hide.
    expect(ports).not.toMatch(/read\(\)\s*:\s*Promise/);
  });
});
