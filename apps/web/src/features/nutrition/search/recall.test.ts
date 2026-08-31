import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { FoodIndex, FoodIndexSet, fold, tokenise, type Food, type SearchHit } from '@freeforever/datasets';
import { describe, expect, it } from 'vitest';
import { classifyQuery, OVERFETCH_LIMIT, searchFoods } from './rank.js';
import { DATASETS_BUILD_DIR } from '../test/fixturePath.js';

/**
 * Search quality, measured against the corpus we actually ship.
 *
 * **The lesson this file exists to encode.** Its previous version measured a
 * 784-record sample and reported 91.6% recall. The index then grew past 98,000
 * records and the same measurement gave 39.6% — not because search regressed
 * but because a number taken on 784 records never predicted anything about
 * 98,000. A loose match that returns a handful of rows shows you the right one;
 * the same loose match over 98,000 returns thousands and buries it.
 *
 * Every figure quoted below was measured on index 2026.08.1, **97,294 records**
 * (core 33,320 + off 63,974), manifest 2026-08-31T14:39Z. The corpus is named
 * next to the numbers deliberately: these comments previously carried figures
 * from a pre-dedupe 98,267-record build and nothing in them said so.
 *
 * So: this file opens `packages/datasets/build/` — the directory
 * `apps/web/scripts/sync-datasets.mjs` copies into the app — and **refuses to
 * report a number if that directory holds a sample.** A recall figure measured
 * on the wrong corpus is worse than no figure, because it is quoted.
 *
 * It deliberately does not look in sibling directories such as `build/full/`.
 * Those are the datasets team's working space, and a test that quietly falls
 * back to one is how you end up measuring something nobody ships.
 *
 * **Two probes, and only one of them is a target.** Recall means "does the food
 * appear in the top k for a query a person would plausibly type for it". Which
 * query that is matters more than k:
 *
 * - *brand + product words* — the user's own acceptance test, "select Optimum
 *   Nutrition and select one serving". This is the target, and it must be near
 *   perfect at k=8, because a phone shows about eight rows.
 * - *the food's leading word alone* — "milk" for one specific carton of milk.
 *   This is reported and **not** targeted. There are thousands of milks; asking
 *   any ranking to put one arbitrary one of them in eight slots is asking for a
 *   coin toss dressed as a metric. The honest answer to an ambiguous query is a
 *   good *page*, not a specific row, which is what `STAPLES` below measures.
 */

/** Under 4 MB gzipped, 97,294 records. Well under this means the sample index. */
const MIN_SHIP_CORPUS = 50_000;

const VERSION = '2026.08.1';

function openShard(shard: 'core' | 'off'): FoodIndex {
  const read = (role: string) =>
    gunzipSync(readFileSync(`${DATASETS_BUILD_DIR}food-${shard}-${role}-${VERSION}.bin.gz`));
  return new FoodIndex({ records: read('records'), search: read('search'), barcodes: read('barcodes') });
}

const core = openShard('core');
const off = openShard('off');
const set = new FoodIndexSet([core, off]);
const corpusSize = core.length + off.length;

const runSearch = (query: string, opts: { limit: number }): SearchHit[] => set.search(query, opts);

/**
 * Every Nth record, deterministically. Record order is likelihood order, so a
 * stride samples across the whole popularity range rather than the head of it.
 */
function sample(index: FoodIndex, n: number): Food[] {
  const out: Food[] = [];
  const stride = Math.max(1, Math.floor(index.length / n));
  for (let i = 0; i < index.length && out.length < n; i += stride) {
    const food = index.get(i);
    if (food) out.push(food);
  }
  return out;
}

/** Two records with the same name and brand are the same food; either will do. */
const identity = (food: { name: string; brand: string | null }) =>
  `${fold(food.name)}|${fold(food.brand ?? '')}`;

interface Probe {
  label: string;
  /** The query a person would type to find this food, or null if not applicable. */
  make: (food: Food) => string | null;
}

const BRAND_AND_PRODUCT: Probe = {
  label: 'brand + product words',
  make: (food) => {
    if (food.brand === null) return null;
    const words = tokenise(food.name).slice(0, 2).join(' ');
    return words === '' ? null : `${food.brand} ${words}`;
  },
};

const FULL_NAME: Probe = { label: 'the name, typed out', make: (food) => food.name };

const LEADING_WORD: Probe = {
  label: 'leading word alone (reported, not targeted)',
  make: (food) => tokenise(food.name)[0] ?? null,
};

function recall(records: readonly Food[], probe: Probe, k: number): number {
  let found = 0;
  let asked = 0;
  for (const food of records) {
    const query = probe.make(food);
    if (query === null || query.trim() === '') continue;
    asked++;
    const { hits } = searchFoods(runSearch, query, k);
    // A collapsed duplicate counts as found. `dedupeHits` merges rows with the
    // same name and brand on purpose, and the survivor is the same food.
    if (hits.some((h) => h.food.id === food.id || identity(h.food) === identity(food))) found++;
  }
  return asked === 0 ? 0 : found / asked;
}

/**
 * The queries that actually matter, and what a good answer looks like.
 *
 * A short generic query is the hard case and the common one: thousands of
 * candidates, and the answer a person weighing their food wants is the plain
 * reference entry, not the fourteenth supermarket own-brand carton. So this
 * measures *precision at k* against a named right answer rather than recall of
 * an arbitrary record — "is the plain food on the first screen".
 *
 * Each pattern was checked against the shipped index rather than guessed. Where
 * a query has two acceptable plain answers ("Cheddar cheese" and "Cheese,
 * cheddar" are both in there) the pattern accepts either.
 */
const STAPLES: readonly [string, RegExp][] = [
  ['milk', /^milk, /iu],
  ['rice', /^rice, /iu],
  ['white rice', /^rice, white/iu],
  ['chicken breast', /^chicken,? breast/iu],
  ['salmon', /^fish, salmon|^salmon, /iu],
  ['tuna', /^fish, tuna/iu],
  ['beef', /^beef, /iu],
  ['ground beef', /^beef, ground/iu],
  ['cheese', /^cheese, /iu],
  ['cheddar', /^cheddar cheese|^cheese, cheddar/iu],
  ['ricotta', /^cheese, ricotta/iu],
  ['parmesan', /^cheese, parmesan/iu],
  ['cottage cheese', /^cheese, cottage/iu],
  ['greek yogurt', /^yogurt, greek/iu],
  ['egg', /^egg, whole|^eggs, /iu],
  ['butter', /^butter, |^butter$/iu],
  ['olive oil', /^oil, olive/iu],
  ['peanut butter', /^creamy peanut butter|^peanut butter/iu],
  ['almonds', /^almonds/iu],
  ['oats', /^oats, whole grain|^oats \(/iu],
  ['bread', /^bread, /iu],
  ['whole wheat bread', /^bread, whole/iu],
  ['banana', /^bananas, |^raw bananas/iu],
  ['broccoli', /^raw broccoli|^broccoli, /iu],
  ['kale', /^raw kale|^kale, /iu],
  ['spinach', /^baby spinach|^mature spinach|^spinach, /iu],
  ['mushrooms', /mushroom/iu],
  ['sweet potato', /^sweet ?potato/iu],
  ['hummus', /^commercial hummus|^hummus/iu],
  // The two known gaps. Kept in the set on purpose: a limitation left out of a
  // metric stops being a limitation and becomes a secret.
  ['potato', /^potatoes, /iu],
  ['apple', /^apples, /iu],
];

/**
 * Queries whose plain answer is in the corpus but sits past the over-fetch.
 *
 * Both are reachable only by deepening `OVERFETCH_LIMIT`, which trades them for
 * other staples and doubles the per-keystroke work — so they are recorded as
 * known and unfixed from this side rather than papered over. The cause is
 * upstream: the index stores records in descending likelihood order, and it has
 * ranked "Potato flour" and "Apple croissants" hundreds of places above
 * "Potatoes, flesh and skin, raw" (core record 1785) and "Apples, raw, without
 * skin" (core record 1282). Reported to the datasets team.
 */
const KNOWN_STAPLE_GAPS = new Set(['potato', 'apple']);

function staplePrecision(k: number): { rate: number; misses: string[] } {
  let found = 0;
  const misses: string[] = [];
  for (const [query, wanted] of STAPLES) {
    const { hits } = searchFoods(runSearch, query, k);
    if (hits.some((h) => h.food.brand === null && wanted.test(h.food.name))) found++;
    else misses.push(query);
  }
  return { rate: found / STAPLES.length, misses };
}

describe('the corpus under measurement', () => {
  it('is the one we ship, or this file reports nothing', () => {
    expect(
      corpusSize,
      `packages/datasets/build/ holds ${corpusSize} records. That is the sample index, not ` +
        'the corpus the app ships. Every recall number below would be measured against the ' +
        'wrong thing — which is exactly how this file previously reported 91.6% for a search ' +
        'that scored 39.6% in production. Rebuild or restore the full artefacts before ' +
        'trusting anything here.',
    ).toBeGreaterThan(MIN_SHIP_CORPUS);
  });
});

describe('recall at the limits a phone actually shows', () => {
  // 800 records, sampled across both shards' full likelihood range. Enough for
  // a stable figure to the nearest point; small enough to stay a few seconds.
  const records = [...sample(core, 400), ...sample(off, 400)];

  it('finds a branded product from its brand and a word or two of its name', () => {
    // The user's acceptance test. "I should just be able to select Optimum
    // Nutrition and select one serving" — so the product has to be on the first
    // screen, not on page three.
    const k8 = recall(records, BRAND_AND_PRODUCT, 8);
    const k20 = recall(records, BRAND_AND_PRODUCT, 20);
    // Measured 99.4% at k=8, 99.8% at k=20 — and identical before this rework.
    // Worth stating plainly: typing a brand never broke. The corpus growing did
    // not touch this probe, and nothing here improved it. What broke was the
    // row underneath, which is what the staple set below measures.
    expect(k8, `brand + product words @8 = ${(k8 * 100).toFixed(1)}%`).toBeGreaterThan(0.98);
    expect(k20, `brand + product words @20 = ${(k20 * 100).toFixed(1)}%`).toBeGreaterThan(0.98);
  });

  it('finds a food whose name was typed out in full', () => {
    const k8 = recall(records, FULL_NAME, 8);
    const k20 = recall(records, FULL_NAME, 20);
    // Short of 100% by design rather than by accident. The remainder is almost
    // entirely branded rows whose *name alone* a dozen other brands also use —
    // "Salmon", "Chocolate", "Chips" — where `diversifyByName` deliberately
    // defers the third and later identical-looking rows so the first screen is
    // not one word repeated eight times. Naming the brand recovers them, which
    // is what the probe above measures.
    // Measured 91.0% at k=8, 93.4% at k=20, against 94.9%/98.6% before this
    // rework. Those four points at k=8 are what a first screen that is not one
    // word repeated eight times costs, and they are recoverable by naming the
    // brand — which is the 99.4% probe above.
    expect(k8, `the name typed out @8 = ${(k8 * 100).toFixed(1)}%`).toBeGreaterThan(0.90);
    expect(k20, `the name typed out @20 = ${(k20 * 100).toFixed(1)}%`).toBeGreaterThan(0.92);
  });

  it('reports leading-word recall without pretending it is a goal', () => {
    const k8 = recall(records, LEADING_WORD, 8);
    const k20 = recall(records, LEADING_WORD, 20);
    // No assertion on the level, deliberately: see the note at the top of this
    // file. What *is* worth guarding is that it has not collapsed to nothing,
    // which would mean the leading word had stopped mattering at all.
    // For the record, since it is the number that raised the alarm: it was
    // reported as 39.6% at k=20 on the pre-dedupe build. On this corpus the old
    // ranker scores 43.0% and this one scores 34.9%. It went *down*, and that is
    // the trade working — recall of one arbitrary record for a common word is
    // anti-correlated with putting the right food first.
    expect(k8, `leading word @8 = ${(k8 * 100).toFixed(1)}%`).toBeGreaterThan(0.15);
    expect(k20, `leading word @20 = ${(k20 * 100).toFixed(1)}%`).toBeGreaterThan(0.2);
    expect(k20).toBeGreaterThan(k8);
  });
});

describe('a short generic query puts the plain food on the first screen', () => {
  it('surfaces the reference food for the staples people actually weigh', () => {
    const { rate, misses } = staplePrecision(8);
    const unexpected = misses.filter((q) => !KNOWN_STAPLE_GAPS.has(q));
    expect(unexpected, `unexpected staple misses at k=8: ${unexpected.join(', ')}`).toEqual([]);
    // 29 of 31 = 93.5%, against 11 of 31 = 35.5% before this rework. This is
    // the column the whole change was for.
    expect(rate, `staples @8 = ${(rate * 100).toFixed(0)}%`).toBeGreaterThan(0.9);
  });

  it('does no worse with more room', () => {
    expect(staplePrecision(20).rate).toBeGreaterThanOrEqual(staplePrecision(8).rate);
  });

  it('prefers the plain reference food over a branded carton for "milk"', () => {
    // The concrete case that started this: "milk" used to return three
    // supermarket own-brands and then milk crackers, milk chocolate candies and
    // a milkshake. The record that IS milk was in the candidate pool the whole
    // time, at position 60 of 200.
    const { hits } = searchFoods(runSearch, 'milk', 8);
    const first = hits[0]?.food;
    expect(first?.brand).toBeNull();
    expect(first?.name).toMatch(/^milk, /iu);
  });

  it('still lets a named brand win over the reference food', () => {
    // The other half of the same coin, and the reason `brandIntent` gates the
    // reference bonus instead of a single weight trying to serve both. Naming a
    // brand must not hand you a USDA row.
    const { hits } = searchFoods(runSearch, 'kirkland chicken breast', 8);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.food.brand?.toLowerCase()).toContain('kirkland');
  });
});

describe('the query the user set as the bar', () => {
  const topName = (query: string) => searchFoods(runSearch, query, 8).hits[0]?.food.name ?? '';

  it('puts Optimum Nutrition Gold Standard whey vanilla first', () => {
    expect(topName('optimum nutrition gold standard whey vanilla')).toMatch(/gold standard/iu);
    expect(topName('optimum nutrition gold standard whey vanilla')).toMatch(/vanilla/iu);
  });

  it('fills the first screen with that brand when only the brand is typed', () => {
    const { hits } = searchFoods(runSearch, 'optimum nutrition', 8);
    expect(hits.length).toBeGreaterThan(0);
    // Every row on the first screen should be theirs. Before this rework the
    // brand-only match was *subtracted* from the score, so typing a brand
    // pushed that brand's products down and let any food with "nutrition" in
    // its name take the screen.
    for (const hit of hits) {
      expect(hit.food.brand?.toLowerCase().replace(/\s+/gu, ' ')).toBe('optimum nutrition');
    }
  });

  it('finds the product without the brand, too', () => {
    expect(topName('gold standard whey')).toMatch(/gold standard/iu);
  });
});

describe('a stopword-only query is an unfinished query, not a missing food', () => {
  it('returns nothing from the index, and the UI is told why', () => {
    for (const raw of ['the', 'de', 'or', 'a', 'of', 'c', '  ']) {
      expect(set.search(raw, { limit: 20 })).toEqual([]);
    }
    expect(classifyQuery('the').kind).toBe('not_yet_searchable');
    expect(classifyQuery('de nigris').kind).toBe('ready');
  });

  it('is present in the index, whatever its name opens with', () => {
    // The old "4.4% of Open Food Facts records are unfindable" figure was a
    // probe artefact: those records open with a word the index does not index.
    //
    // This used to probe by the food's *first* indexed term, which was a fair
    // demonstration over 784 records and is meaningless over 97,294 — "beef"
    // alone matches five hundred unbranded USDA rows before the branded ones,
    // so a top-N search cannot hold them all however large N is. Probing by the
    // whole token sequence tests what the claim was always about: that the
    // record is in the index and reachable, not that it wins a popularity
    // contest for one common word.
    for (const food of [...sample(core, 200), ...sample(off, 200)]) {
      const terms = tokenise(food.name);
      expect(terms.length).toBeGreaterThan(0);
      const shard = food.shard === 'core' ? core : off;
      expect(
        shard.search(terms.join(' '), { limit: 800 }).some((h) => h.food.id === food.id),
        `${food.name} not present under its own terms`,
      ).toBe(true);
    }
  });
});

describe('the query path stays offline and instant', () => {
  it('answers keystroke by keystroke in well under a frame, at 97k records', () => {
    const started = performance.now();
    for (const prefix of [
      'ch', 'chi', 'chic', 'chick', 'chicke', 'chicken',
      'mi', 'mil', 'milk',
      'op', 'opt', 'optim', 'optimum',
    ]) {
      searchFoods(runSearch, prefix, 20);
    }
    // Thirteen keystrokes across three words. Measured at about 13 ms on the
    // shipped corpus, and 10.9 ms worst-case per keystroke in a real browser at
    // 412 px. The bound is generous because this is a regression guard against
    // an accidental full scan, not a benchmark.
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('over-fetches by the documented amount and no more', () => {
    let requested = -1;
    searchFoods((query, opts) => {
      requested = opts.limit;
      return set.search(query, opts);
    }, 'chicken', 25);
    expect(requested).toBe(OVERFETCH_LIMIT);
  });

  it('returns nothing for a query the index cannot tokenise, without throwing', () => {
    for (const raw of ['', '   ', '!!!', 'the', '💥']) {
      expect(() => searchFoods(runSearch, raw, 25)).not.toThrow();
      expect(searchFoods(runSearch, raw, 25).hits).toEqual([]);
    }
  });
});

describe('barcodes resolve from the same on-device index', () => {
  it('finds a known Open Food Facts product by its GTIN', () => {
    const withBarcode = sample(off, 400).find((f) => f.barcode !== null);
    expect(withBarcode).toBeDefined();
    const found = set.byBarcode(withBarcode?.barcode ?? '');
    expect(found?.id).toBe(withBarcode?.id);
  });

  it('returns null for an unknown barcode rather than throwing', () => {
    expect(set.byBarcode('0000000000000')).toBeNull();
    expect(set.byBarcode('not-a-barcode')).toBeNull();
  });
});
