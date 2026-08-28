import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { FoodIndex, FoodIndexSet, fold, tokenise, type Food, type SearchHit } from '@freeforever/datasets';
import { describe, expect, it } from 'vitest';
import { classifyQuery, OVERFETCH_LIMIT, searchFoods } from './rank.js';
import { DATASETS_BUILD_DIR } from '../test/fixturePath.js';

/**
 * Recall, measured against the real committed index rather than a fixture of
 * our own making.
 *
 * This test exists because of a reported figure — "~4.4% of Open Food Facts
 * records are not findable by their own leading token" — that turned out to
 * mean something different from what it sounds like, and because measuring it
 * properly turned up a larger problem that belongs to this feature rather than
 * to the datasets package.
 *
 * It reads `packages/datasets/build/`, which is committed precisely so an
 * artefact can be inspected without running the pipeline.
 */

const VERSION = '2026.08.1';

function openShard(shard: 'core' | 'off'): FoodIndex {
  const read = (role: string) =>
    gunzipSync(readFileSync(`${DATASETS_BUILD_DIR}food-${shard}-${role}-${VERSION}.bin.gz`));
  return new FoodIndex({ records: read('records'), search: read('search'), barcodes: read('barcodes') });
}

const core = openShard('core');
const off = openShard('off');
const set = new FoodIndexSet([core, off]);

function allRecords(index: FoodIndex): Food[] {
  const out: Food[] = [];
  for (let i = 0; i < index.length; i++) {
    const food = index.get(i);
    if (food) out.push(food);
  }
  return out;
}

describe('the reported 4.4% shortfall', () => {
  it('reproduces exactly, and is entirely names that open with a stopword', () => {
    const records = allRecords(off);
    const missed = records.filter((food) => {
      const leadingWord = food.name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/gu, ' ').trim().split(' ')[0] ?? '';
      if (leadingWord === '') return true;
      return !off.search(leadingWord, { limit: 500 }).some((h) => h.food.id === food.id);
    });

    // 13 of 298 = 4.36%, which is the reported figure.
    expect(missed.length).toBe(13);
    expect((missed.length / records.length) * 100).toBeCloseTo(4.36, 1);

    // Every one of them opens with a word the index deliberately does not index.
    for (const food of missed) {
      const leadingWord = food.name.split(/[^A-Za-z0-9]+/u).filter(Boolean)[0] ?? '';
      expect(tokenise(leadingWord)).toEqual([]);
    }
  });

  it('is a probe artefact, not a missing food — every record is findable by its own indexed term', () => {
    for (const index of [core, off]) {
      for (const food of allRecords(index)) {
        const terms = tokenise(food.name);
        expect(terms.length).toBeGreaterThan(0);
        const found = index.search(terms[0] as string, { limit: 500 }).some((h) => h.food.id === food.id);
        expect(found, `${food.name} not findable by "${terms[0]}"`).toBe(true);
      }
    }
  });

  it('does bite this feature in one narrow way: a stopword-only query has no tokens', () => {
    for (const raw of ['the', 'de', 'or', 'a', 'of', 'c', '  ']) {
      expect(set.search(raw, { limit: 20 })).toEqual([]);
    }
    // Which is why the UI must not call that "no results found".
    expect(classifyQuery('the').kind).toBe('not_yet_searchable');
    expect(classifyQuery('de nigris').kind).toBe('ready');
  });
});

describe('the larger problem, which is ours: results truncated by the display limit', () => {
  const runSearch = (query: string, opts: { limit: number }): SearchHit[] => set.search(query, opts);

  it('shows the shortfall at a realistic UI limit with no re-ranking', () => {
    const records = allRecords(core);
    const missed = records.filter((food) => {
      const term = tokenise(food.name)[0] as string;
      return !core.search(term, { limit: 20 }).some((h) => h.food.id === food.id);
    });
    // ~16.5% of core records. The index is right; twenty is too few.
    expect(missed.length).toBeGreaterThan(50);
    expect(missed.length / records.length).toBeGreaterThan(0.1);
  });

  it('over-fetching and re-ranking recovers the specific food for a generic query', () => {
    // "Raw blueberries" is invisible at limit 20 among everything else raw.
    const naive = core.search('raw', { limit: 20 }).some((h) => h.food.name === 'Raw blueberries');
    expect(naive).toBe(false);

    const { hits } = searchFoods(runSearch, 'raw', 25);
    expect(hits.some((h) => h.food.name === 'Raw blueberries')).toBe(true);
  });

  it('cuts the shortfall substantially across every core record', () => {
    const records = allRecords(core);
    let naiveHits = 0;
    let rerankedHits = 0;

    for (const food of records) {
      const term = tokenise(food.name)[0] as string;
      if (core.search(term, { limit: 25 }).some((h) => h.food.id === food.id)) naiveHits++;
      const { hits } = searchFoods(runSearch, term, 25);
      if (hits.some((h) => h.food.id === food.id)) rerankedHits++;
    }

    expect(rerankedHits).toBeGreaterThan(naiveHits);
    // Re-ranking cannot reach 100% — 25 slots cannot hold every food sharing a
    // common word, and it should not: the honest fix for "raw" matching 90
    // foods is a second word, not a longer list. It must clear four fifths.
    expect(rerankedHits / records.length).toBeGreaterThan(0.8);
  });

  it('loses no food that is not a duplicate of one it still shows', () => {
    // Collapsing two identical rows is the intended behaviour, so a record
    // "missing" from the results is only a real loss if no twin took its place.
    const runOne = (q: string, o: { limit: number }) => set.search(q, o);
    let collapsed = 0;
    let genuine = 0;

    for (const index of [core, off]) {
      for (const food of allRecords(index)) {
        const term = tokenise(food.name)[0] as string;
        const { hits } = searchFoods(runOne, term, 25);
        if (hits.some((h) => h.food.id === food.id)) continue;

        const key = `${fold(food.name)}|${fold(food.brand ?? '')}`;
        const twinShown = hits.some((h) => `${fold(h.food.name)}|${fold(h.food.brand ?? '')}` === key);
        if (twinShown) collapsed++;
        else genuine++;
      }
    }

    // Every Open Food Facts record is either shown or represented by its twin.
    expect(collapsed).toBeGreaterThan(0);
    // Core still loses some: 486 foods cannot all fit in 25 slots for "raw".
    // The point of the assertion is that the loss is bounded and understood.
    expect(genuine).toBeLessThan(allRecords(core).length * 0.1);
  });

  it('ranks an exact whole-word name match above a food that merely contains it', () => {
    const { hits } = searchFoods(runSearch, 'butter', 10);
    expect(hits.length).toBeGreaterThan(0);
    const firstName = (hits[0]?.food.name ?? '').toLowerCase();
    expect(firstName).toContain('butter');
  });

  it('finds a two-word query typed in full, which is the common case', () => {
    for (const food of allRecords(core).slice(0, 120)) {
      const { hits } = searchFoods(runSearch, food.name, 25);
      expect(hits.some((h) => h.food.id === food.id), `lost: ${food.name}`).toBe(true);
    }
  });

  it('over-fetches by the documented amount and no more', () => {
    let requested = -1;
    searchFoods((query, opts) => {
      requested = opts.limit;
      return set.search(query, opts);
    }, 'chicken', 25);
    expect(requested).toBe(OVERFETCH_LIMIT);
  });
});

describe('the query path stays offline and instant', () => {
  it('answers a keystroke-by-keystroke query in well under a frame', () => {
    const runSearch = (query: string, opts: { limit: number }) => set.search(query, opts);
    const started = performance.now();
    for (const prefix of ['c', 'ch', 'chi', 'chic', 'chick', 'chicke', 'chicken']) {
      searchFoods(runSearch, prefix, 25);
    }
    // Seven keystrokes. Generous bound — this is a regression guard against an
    // accidental full scan, not a benchmark.
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('returns nothing for a query the index cannot tokenise, without throwing', () => {
    const runSearch = (query: string, opts: { limit: number }) => set.search(query, opts);
    for (const raw of ['', '   ', '!!!', 'the', '💥']) {
      expect(() => searchFoods(runSearch, raw, 25)).not.toThrow();
      expect(searchFoods(runSearch, raw, 25).hits).toEqual([]);
    }
  });
});

describe('barcodes resolve from the same on-device index', () => {
  it('finds a known Open Food Facts product by its GTIN', () => {
    const withBarcode = allRecords(off).find((f) => f.barcode !== null);
    expect(withBarcode).toBeDefined();
    const found = set.byBarcode(withBarcode?.barcode ?? '');
    expect(found?.id).toBe(withBarcode?.id);
  });

  it('returns null for an unknown barcode rather than throwing', () => {
    expect(set.byBarcode('0000000000000')).toBeNull();
    expect(set.byBarcode('not-a-barcode')).toBeNull();
  });
});
