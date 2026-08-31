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
 * Every figure quoted below was measured on index 2026.08.1, **95,996 records**
 * (core 32,123 + off 63,873), manifest 2026-08-31T15:40Z. The corpus is named
 * next to the numbers deliberately: these comments once carried figures from a
 * pre-dedupe 98,267-record build and nothing in them said so.
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

/** Under 4 MB gzipped, 95,996 records. Well under this means the sample index. */
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
 * Each pattern was checked against the shipped index rather than guessed, and
 * every one of them was audited by printing *what it actually matched* rather
 * than trusting that it passed. That audit is how the "chicken breast" pattern
 * was caught passing on a deli roll while the raw cut sat at rank 11 — the same
 * dishonest green the datasets team found in their own probe, from the other
 * direction. A pattern that can pass on the wrong row is worse than a failing
 * one, because it retires the defect.
 *
 * Where the line is drawn, since it is a judgement and not a rule: a different
 * *preparation* of the same food is an acceptable answer — "Kale, frozen,
 * cooked" for "kale", "Salmon, sockeye, canned" for "salmon" — because logging
 * cooked kale is a real thing a person does. A different *product* is not:
 * "Chicken breast, roll, oven-roasted" is a deli slice, not a chicken breast.
 *
 * Where a query has two acceptable plain answers ("Cheddar cheese" and "Cheese,
 * cheddar" are both in there) the pattern accepts either.
 */
const STAPLES: readonly [string, RegExp][] = [
  ['milk', /^milk, /iu],
  ['rice', /^rice, /iu],
  ['white rice', /^rice, white/iu],
  // `/^chicken,? breast/` passed on "Chicken breast, roll, oven-roasted" — a
  // deli product, with the raw cut down at rank 11. The comma is load-bearing:
  // USDA writes the cut after it, so requiring it excludes the products whose
  // name merely opens with the query. See the note under STAPLES on where this
  // line is drawn.
  ['chicken breast', /^chicken, (breast|broilers?)/iu],
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
 * One miss out of 31 is tolerated; the shipped index currently misses none.
 *
 * This used to carry a `KNOWN_STAPLE_GAPS` set naming "potato" and "apple",
 * whose plain records sat past the over-fetch. They are gone, and the reason is
 * worth keeping because I had the diagnosis wrong: I read it as record order and
 * reported it as such. The actual defect was in the reader's prefix scoring,
 * which penalised an expansion by `needle.length / term.length` — and USDA names
 * generic whole foods in the plural and derived products in the singular:
 *
 *     "Potatoes, russet, without skin, raw"   term "potatoes"  6/8 = 0.75
 *     "Potato flour"                          term "potato"    exact = 1.00
 *
 * A quarter of a point of handicap for being a plural, which no ranking of mine
 * could repay. `search("potatoes")` put plain raw potatoes at ranks 1-3 while
 * `search("potato")` put the first one at 539 — same index, one letter of query.
 * Fixed upstream; the guard for it is the test below.
 */
const STAPLE_MISS_TOLERANCE = 1;

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
    // Measured 98.5% at k=8, 99.4% at k=20. Down from 99.2%/99.8% on the
    // previous build, and the cause is upstream rather than here: the adapter
    // now nulls a brand field that merely repeated the product name, so 5,305
    // records that used to be findable *by that junk brand* no longer are.
    // Correct, but it leaves only half a point above the floor — if this trips
    // on a future rebuild, check the brand population before touching weights.
    //
    // Worth stating plainly: typing a brand never broke. What broke was the row
    // underneath, which the staple set below measures.
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
    // Measured 96.5% at k=8, 97.0% at k=20. The gap to a no-diversification
    // ranking is what a first screen which is not one word repeated eight times
    // costs, and it is recoverable by naming the brand — the probe above. It
    // has narrowed from four points to about one as the upstream defects were
    // fixed: 91.0% two builds ago, 94.9% one build ago, 96.5% now.
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
    // reported as 39.6% at k=20 on the pre-dedupe build, and measures 37.8%
    // here. It stays below what a ranking tuned *for* it would score, and that
    // is the trade working — recall of one arbitrary record for a common word
    // is anti-correlated with putting the right food first.
    expect(k8, `leading word @8 = ${(k8 * 100).toFixed(1)}%`).toBeGreaterThan(0.15);
    expect(k20, `leading word @20 = ${(k20 * 100).toFixed(1)}%`).toBeGreaterThan(0.2);
    expect(k20).toBeGreaterThan(k8);
  });
});

describe('a short generic query puts the plain food on the first screen', () => {
  it('surfaces the reference food for the staples people actually weigh', () => {
    const { rate, misses } = staplePrecision(8);
    // 31 of 31, honestly — every pattern audited against what it matched, not
    // just that it matched. 15 of 31 for the previous ranker on this corpus.
    // This is the column the whole change was for. One miss is tolerated so a
    // rebuild that shuffles one borderline food is a conversation rather than a
    // red build; two is a regression worth stopping for.
    expect(misses.length, `staple misses at k=8: ${misses.join(', ') || 'none'}`).toBeLessThanOrEqual(
      STAPLE_MISS_TOLERANCE,
    );
    expect(rate, `staples @8 = ${(rate * 100).toFixed(0)}%`).toBeGreaterThan(0.95);
  });

  it('does no worse with more room', () => {
    expect(staplePrecision(20).rate).toBeGreaterThanOrEqual(staplePrecision(8).rate);
  });

  it('finds the plural generic from the singular a person types', () => {
    // The guard for the defect described above `STAPLE_MISS_TOLERANCE`. Nobody
    // types "potatoes" or "apples"; USDA names the plain food in the plural and
    // the derived product in the singular, so a singular query has to reach the
    // plural record without being handicapped for it.
    for (const [query, wanted] of [
      ['potato', /^potatoes, /iu],
      ['apple', /^apples, /iu],
      ['carrot', /^carrots, /iu],
      ['onion', /^onions, /iu],
    ] as const) {
      const { hits } = searchFoods(runSearch, query, 8);
      expect(
        hits.some((h) => h.food.brand === null && wanted.test(h.food.name)),
        `"${query}" did not surface ${String(wanted)} — top: ${hits
          .slice(0, 3)
          .map((h) => h.food.name)
          .join(' / ')}`,
      ).toBe(true);
    }
  });

  it('does not treat every longer word as a plural of the query', () => {
    // The other side of the same fix: "milkshake" is not the plural of "milk",
    // and a query for milk must not be handed one as an equal match. Pinned
    // here rather than only upstream, because this is the assertion that fails
    // if the suffix rule is ever loosened.
    const { hits } = searchFoods(runSearch, 'milk', 8);
    expect(hits.every((h) => !/milkshake/iu.test(h.food.name))).toBe(true);
  });

  it('prefers the plain reference food over a branded carton for "milk"', () => {
    // The concrete case that started this: "milk" used to return three
    // supermarket own-brands and then milk crackers, milk chocolate candies and
    // a milkshake. The record that IS milk was in the candidate pool the whole
    // time — position 116 when this was diagnosed, and near the top today,
    // because the index's own ordering improved underneath. Which is the tell:
    // when the right answer is already in the pool, the fetch was never the
    // problem, and deepening it will not help.
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
    // demonstration over 784 records and is meaningless over 95,996 — "beef"
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
  it('answers keystroke by keystroke in well under a frame, at 96k records', () => {
    const started = performance.now();
    for (const prefix of [
      'ch', 'chi', 'chic', 'chick', 'chicke', 'chicken',
      'mi', 'mil', 'milk',
      'op', 'opt', 'optim', 'optimum',
    ]) {
      searchFoods(runSearch, prefix, 20);
    }
    // Thirteen keystrokes across three words, on the shipped corpus. The bound
    // is generous because this is a regression guard against an accidental full
    // scan, not a benchmark; the browser figure is in the commit message.
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
