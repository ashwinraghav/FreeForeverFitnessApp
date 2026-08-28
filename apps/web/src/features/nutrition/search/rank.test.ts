import { describe, expect, it } from 'vitest';
import {
  classifyQuery,
  dedupeHits,
  OVERFETCH_LIMIT,
  rankScore,
  rerank,
  searchFoods,
  type RankableFood,
  type RankableHit,
} from './rank.js';

const food = (id: string, name: string, brand: string | null = null, highConfidence = false): RankableFood => ({
  id,
  name,
  brand,
  flags: { highConfidence },
});

const hit = (f: RankableFood, score = 1): RankableHit => ({ food: f, score });

describe('classifyQuery', () => {
  it('separates an empty box from a query that cannot match', () => {
    expect(classifyQuery('').kind).toBe('empty');
    expect(classifyQuery('   ').kind).toBe('empty');
  });

  it('flags a query with no indexable token, rather than calling it a miss', () => {
    // These are all stopwords or single characters the index deliberately does
    // not index. Reporting "no results" here is a lie about the data.
    for (const raw of ['the', 'a', 'of', 'or', 'c', '!', '...']) {
      expect(classifyQuery(raw).kind, raw).toBe('not_yet_searchable');
    }
  });

  it('accepts a query as soon as one token survives tokenisation', () => {
    expect(classifyQuery('de nigris').kind).toBe('ready');
    expect(classifyQuery('the madelaine').kind).toBe('ready');
    expect(classifyQuery('2%').kind).toBe('ready'); // digits are kept on purpose
  });

  it('exposes the tokens the index will actually use', () => {
    expect(classifyQuery('The Greek Yogurt').tokens).toEqual(['greek', 'yogurt']);
  });
});

describe('rankScore', () => {
  it('scores a whole-word name match above a brand-only match', () => {
    const tokens = ['kellogg'];
    const inName = rankScore(hit(food('a', 'Kellogg Corn Flakes')), tokens, 1);
    const inBrand = rankScore(hit(food('b', 'Corn Flakes', 'Kellogg')), tokens, 1);
    expect(inName).toBeGreaterThan(inBrand);
  });

  it('rewards a name that opens with what was typed', () => {
    const tokens = ['raw'];
    const opens = rankScore(hit(food('a', 'Raw blueberries')), tokens, 1);
    const buried = rankScore(hit(food('b', 'Beef, ground, raw, lean')), tokens, 1);
    expect(opens).toBeGreaterThan(buried);
  });

  it('prefers the shorter, more specific name', () => {
    const tokens = ['flour'];
    const short = rankScore(hit(food('a', 'Flour, wheat')), tokens, 1);
    const long = rankScore(hit(food('b', 'Flour, semolina, coarse and semi-coarse, enriched')), tokens, 1);
    expect(short).toBeGreaterThan(long);
  });

  it('treats the final token as a prefix, because the user is still typing it', () => {
    const partial = rankScore(hit(food('a', 'Chicken breast')), ['chicken', 'brea'], 1);
    const unrelated = rankScore(hit(food('b', 'Chicken thigh')), ['chicken', 'brea'], 1);
    expect(partial).toBeGreaterThan(unrelated);
  });

  it('requires an exact match on a non-final token', () => {
    // "chick breast" must not score "chickpea" full coverage on the first token.
    const exact = rankScore(hit(food('a', 'Chick peas breast')), ['chick', 'breast'], 1);
    const prefixOnly = rankScore(hit(food('b', 'Chickpea breast')), ['chick', 'breast'], 1);
    expect(exact).toBeGreaterThan(prefixOnly);
  });

  it('gives a lab-analysed record a small edge over an equal one', () => {
    const tokens = ['milk'];
    const confident = rankScore(hit(food('a', 'Milk, whole', null, true)), tokens, 1);
    const ordinary = rankScore(hit(food('b', 'Milk, whole', null, false)), tokens, 1);
    expect(confident).toBeGreaterThan(ordinary);
  });
});

describe('rerank', () => {
  it('lifts the specific food above the generic ones', () => {
    const hits = [
      hit(food('1', 'Beef, ground, raw'), 1),
      hit(food('2', 'Pork, shoulder, raw'), 0.98),
      hit(food('3', 'Raw blueberries'), 0.4),
    ];
    expect(rerank(hits, ['raw'])[0]?.food.id).toBe('3');
  });

  it('does not truncate — that happens after deduplication', () => {
    const hits = Array.from({ length: 50 }, (_, i) => hit(food(String(i), `Food ${i}`)));
    expect(rerank(hits, ['food'])).toHaveLength(50);
  });

  it('is deterministic and stable across identical calls', () => {
    const hits = [hit(food('a', 'Milk')), hit(food('b', 'Milk')), hit(food('c', 'Milk'))];
    expect(rerank(hits, ['milk']).map((h) => h.food.id)).toEqual(
      rerank(hits, ['milk']).map((h) => h.food.id),
    );
  });

  it('handles an empty result set and an all-zero score set', () => {
    expect(rerank([], ['x'])).toEqual([]);
    expect(rerank([hit(food('a', 'Milk'), 0)], ['milk'])).toHaveLength(1);
  });
});

describe('dedupeHits', () => {
  it('collapses the same food appearing in both shards', () => {
    const hits = [
      hit(food('core:1', 'Nutella', 'Ferrero')),
      hit(food('off:2', 'nutella', 'FERRERO')),
      hit(food('off:3', 'Nutella', 'Other brand')),
    ];
    const out = dedupeHits(hits);
    expect(out).toHaveLength(2);
    // The first occurrence wins, so this must run after re-ranking.
    expect(out[0]?.food.id).toBe('core:1');
  });

  it('folds case, punctuation and diacritics the way the index does', () => {
    const out = dedupeHits([hit(food('a', 'Crème Fraîche')), hit(food('b', 'Creme Fraiche'))]);
    expect(out).toHaveLength(1);
  });

  it('keeps genuinely different foods', () => {
    const out = dedupeHits([hit(food('a', 'Milk', 'Alpro')), hit(food('b', 'Milk', 'Oatly'))]);
    expect(out).toHaveLength(2);
  });
});

describe('searchFoods', () => {
  it('over-fetches, then cuts to the display limit after deduplication', () => {
    const source = Array.from({ length: 300 }, (_, i) => hit(food(String(i), `Chicken ${i}`)));
    let asked = 0;
    const { hits } = searchFoods((_q, opts) => {
      asked = opts.limit;
      return source.slice(0, opts.limit);
    }, 'chicken', 20);

    expect(asked).toBe(OVERFETCH_LIMIT);
    expect(hits).toHaveLength(20);
  });

  it('returns a full page even when the over-fetched set contained duplicates', () => {
    // 40 distinct foods, each duplicated. A naive cut-then-dedupe returns 10.
    const source = Array.from({ length: 40 }, (_, i) => [
      hit(food(`a${i}`, `Food ${i}`)),
      hit(food(`b${i}`, `Food ${i}`)),
    ]).flat();
    const { hits } = searchFoods(() => source, 'food', 20);
    expect(hits).toHaveLength(20);
    expect(new Set(hits.map((h) => h.food.name)).size).toBe(20);
  });

  it('never calls the index for a query that cannot match', () => {
    let called = false;
    for (const raw of ['', '  ', 'the', 'a']) {
      searchFoods(() => {
        called = true;
        return [];
      }, raw, 20);
    }
    expect(called).toBe(false);
  });

  it('reports why a query returned nothing', () => {
    expect(searchFoods(() => [], 'the', 20).query.kind).toBe('not_yet_searchable');
    expect(searchFoods(() => [], 'chicken', 20).query.kind).toBe('ready');
  });
});
