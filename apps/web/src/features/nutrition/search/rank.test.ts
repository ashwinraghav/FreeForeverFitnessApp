import { describe, expect, it } from 'vitest';
import {
  analyseHit,
  brandIntent,
  classifyQuery,
  dedupeHits,
  diversifyByName,
  hitFeatures,
  MAX_SAME_NAME_UP_FRONT,
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

/** An unbranded USDA reference record — the plain entry for a whole food. */
const reference = (id: string, name: string): RankableFood => ({
  id,
  name,
  brand: null,
  source: 'usda-sr-legacy',
  flags: { highConfidence: true },
});

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

describe('the head clause of a USDA name', () => {
  it('counts as an exact match, because it is the food’s actual name', () => {
    // USDA writes head-then-qualifiers. "Milk, whole, 3.25% milkfat" is the
    // record that IS milk; without this it looks like a four-word partial match
    // and loses to any supermarket carton literally named "Milk".
    expect(hitFeatures(reference('a', 'Milk, whole, 3.25% milkfat'), ['milk']).headExact).toBe(1);
    expect(hitFeatures(reference('b', 'Rice, white, long grain, raw'), ['rice']).headExact).toBe(1);
  });

  it('does not fire when the query is only part of the head', () => {
    expect(hitFeatures(reference('a', 'Milk crackers'), ['milk']).headExact).toBe(0);
    expect(hitFeatures(reference('b', 'Milk chocolate candies'), ['milk']).headExact).toBe(0);
  });

  it('tolerates the plural the packet uses and the singular the user types', () => {
    // The last query token is a prefix, the same rule the index applies.
    expect(hitFeatures(reference('a', 'Bananas, ripe, raw'), ['banana']).headExact).toBe(1);
  });

  it('puts the plain food above a processed one with a tighter name', () => {
    const plain = rankScore(hit(reference('a', 'Milk, whole, 3.25% milkfat')), ['milk'], 1);
    const processed = rankScore(hit(reference('b', 'Milk crackers')), ['milk'], 1);
    expect(plain).toBeGreaterThan(processed);
  });
});

describe('a brand the user names should win', () => {
  const tokens = ['optimum', 'nutrition'];

  it('scores a fully-named brand above a food that merely borrows one of its words', () => {
    // The regression that produced "the only option is the wrong product": the
    // brand-only match used to be *subtracted*, so typing a brand pushed that
    // brand's own products down.
    const theirs = rankScore(hit(food('a', 'Serious Mass', 'Optimum Nutrition')), tokens, 1);
    const borrowed = rankScore(hit(food('b', 'Nutrition Bar')), tokens, 1);
    expect(theirs).toBeGreaterThan(borrowed);
  });

  it('scores a fully-named brand above a half-named one', () => {
    const full = hitFeatures(food('a', 'Whey', 'Optimum Nutrition'), tokens).brandNamed;
    const half = hitFeatures(food('b', 'Whey', 'Optimum Foods'), tokens).brandNamed;
    expect(full).toBe(1);
    expect(half).toBe(0.5);
  });
});

describe('brandIntent decides whether the reference-food bonus applies', () => {
  const analyse = (foods: readonly RankableFood[], tokens: readonly string[]) =>
    brandIntent(foods.map((f) => analyseHit(f, tokens)), tokens.length);

  it('is 1 when a query word only ever appears as a brand', () => {
    // "kirkland" names no food. Someone typing it means the shop, so USDA's
    // plain fish must not outrank Kirkland's salmon.
    const tokens = ['kirkland', 'salmon'];
    expect(
      analyse([food('a', 'Salmon', 'Kirkland'), reference('b', 'Fish, salmon, chinook, raw')], tokens),
    ).toBe(1);
  });

  it('is 0 when every query word also names a food somewhere in the pool', () => {
    // Some brand really is called "Greek Yogurt". Taking that as brand intent
    // suppressed the bonus that surfaces USDA's plain Greek yogurt — the false
    // positive that made this token-exclusivity rule necessary.
    const tokens = ['greek', 'yogurt'];
    expect(
      analyse(
        [
          food('a', 'Plain', 'Greek Yogurt'),
          food('b', 'Greek Yogurt', 'Koukakis'),
          reference('c', 'Yogurt, Greek, plain, nonfat'),
        ],
        tokens,
      ),
    ).toBe(0);
  });

  it('is 0 for a pool with no brands at all', () => {
    expect(analyse([reference('a', 'Milk, whole'), reference('b', 'Milk crackers')], ['milk'])).toBe(0);
  });

  it('gates the bonus rather than switching it, so a half-named brand half-applies', () => {
    const tokens = ['kirkland', 'chicken'];
    const gate = analyse(
      [food('a', 'Chicken', 'Kirkland Signature'), reference('b', 'Chicken, breast, raw')],
      tokens,
    );
    expect(gate).toBe(0.5);
  });
});

describe('diversifyByName', () => {
  const salmons = [
    hit(food('a', 'Salmon', 'Kirkland')),
    hit(food('b', 'Salmon', 'Aldi')),
    hit(food('c', 'Salmon', 'Tesco')),
    hit(food('d', 'Salmon', 'Coles')),
    hit(reference('e', 'Fish, salmon, chinook, raw')),
  ];

  it('moves rows past the cap behind everything else', () => {
    const out = diversifyByName(salmons, 2);
    expect(out.map((h) => h.food.id)).toEqual(['a', 'b', 'e', 'c', 'd']);
  });

  it('leaves a run shorter than the cap alone', () => {
    // Four "Salmon" rows, cap of five: nothing to defer.
    expect(diversifyByName(salmons).map((h) => h.food.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('demotes, never drops — every food is still in the list', () => {
    // An earlier version cut them, which cost seven and a half points of recall
    // and made a longer list useless: the rows a user scrolled for had been
    // deleted rather than deferred.
    const out = diversifyByName(salmons, 2);
    expect(out).toHaveLength(salmons.length);
    expect(new Set(out.map((h) => h.food.id))).toEqual(new Set(['a', 'b', 'c', 'd', 'e']));
  });

  it('keeps relative order within both groups', () => {
    const out = diversifyByName(salmons, 1);
    expect(out.map((h) => h.food.id)).toEqual(['a', 'e', 'b', 'c', 'd']);
  });

  it('caps at five by default, which is what ships', () => {
    expect(MAX_SAME_NAME_UP_FRONT).toBe(5);
    const six = Array.from({ length: 6 }, (_, i) => hit(food(`s${i}`, 'Salmon', `Shop ${i}`)));
    const out = diversifyByName([...six, hit(reference('r', 'Fish, salmon, raw'))]);
    expect(out.map((h) => h.food.id)).toEqual(['s0', 's1', 's2', 's3', 's4', 'r', 's5']);
  });

  it('leaves a list of distinct names untouched', () => {
    const distinct = [hit(food('a', 'Milk')), hit(food('b', 'Cheese')), hit(food('c', 'Butter'))];
    expect(diversifyByName(distinct).map((h) => h.food.id)).toEqual(['a', 'b', 'c']);
  });

  it('folds case and accents, so two spellings of one name count as one', () => {
    const out = diversifyByName(
      [
        hit(food('a', 'Crème Fraîche', 'One')),
        hit(food('b', 'creme fraiche', 'Two')),
        hit(food('c', 'CREME FRAICHE', 'Three')),
        hit(food('d', 'Butter', 'Four')),
      ],
      2,
    );
    expect(out.map((h) => h.food.id)).toEqual(['a', 'b', 'd', 'c']);
  });
});

/**
 * The seam a second source would use, pinned.
 *
 * A remote lookup against Open Food Facts is likely, for the 407,215 records
 * that passed every quality gate and were then dropped at the 4 MB budget. It
 * is not built and must not be assumed here — the local index has to give a
 * good answer standalone, offline, with no network (ADR-0016).
 *
 * What these tests are for is the two hazards in the paragraph above them: both
 * are real, both were found by reading this file rather than by running it, and
 * both are silent. Someone adding a remote tail will merge it into the local
 * hits because that is the obvious thing to do, and the list will reorder under
 * the user's thumb. Pinning them as passing tests means that person meets them
 * as documented behaviour instead of as a bug report from a gym.
 */
describe('ranking is source-agnostic, with two set-relative catches', () => {
  const local = (id: string, name: string, brand: string | null = null, score = 1) =>
    hit({ id, name, brand, source: 'off', flags: { highConfidence: true } }, score);

  it('ranks whatever hits it is handed, wherever they came from', () => {
    // The seam itself: `runSearch` is a parameter, and nothing in the pipeline
    // reads the index. A source that yields `{food, score}` needs no changes.
    const remoteOnly = searchFoods(
      () => [local('r1', 'Gold Standard Whey Vanilla', 'Optimum Nutrition')],
      'optimum nutrition gold standard',
      8,
    );
    expect(remoteOnly.hits.map((h) => h.food.id)).toEqual(['r1']);
  });

  it('CATCH 1: one normalisation across two score scales distorts the blend', () => {
    // The index's own score is normalised by the batch maximum, because the
    // format contract says it is comparable only within one result set. Hand it
    // a batch where one source scores 1..2 and another 50..100 and the small-
    // scale source loses its share of the blend entirely.
    const tokens = ['whey'];
    const mixedBatch = [local('a', 'Whey protein', null, 2), local('b', 'Whey isolate', null, 100)];
    const ownBatch = [local('a', 'Whey protein', null, 2)];

    const inMixed = rerank(mixedBatch, tokens).findIndex((h) => h.food.id === 'a');
    const scoreInMixed = rankScore(mixedBatch[0] as RankableHit, tokens, 2 / 100);
    const scoreInOwn = rankScore(ownBatch[0] as RankableHit, tokens, 2 / 2);

    expect(scoreInOwn).toBeGreaterThan(scoreInMixed);
    expect(inMixed).toBe(1);
  });

  it('CATCH 2: one added hit can flip the brand gate and reorder everything', () => {
    // "kirkland" is a brand word only because no food is *named* kirkland. A
    // single extra hit with it in the name is enough to make the gate open, and
    // the gate multiplies the reference bonus on every unbranded USDA row — so
    // rows the user is already looking at move.
    const tokens = ['kirkland', 'salmon'];
    const localHits = [
      hit(food('k', 'Salmon', 'Kirkland')),
      hit(reference('u', 'Fish, salmon, chinook, raw')),
    ];
    const brandWins = rerank(localHits, tokens).map((h) => h.food.id);
    expect(brandWins).toEqual(['k', 'u']);

    // Now a second source contributes a food whose NAME contains the word.
    const withRemoteTail = [...localHits, hit(food('r', 'Kirkland Style Bake', 'Someone Else'))];
    const gateOpened = rerank(withRemoteTail, tokens).map((h) => h.food.id);
    expect(gateOpened[0]).toBe('u');
    expect(gateOpened).not.toEqual(brandWins.concat('r'));
  });

  it('ranking each source as its own set leaves the first list untouched', () => {
    // Which is the whole recommendation: rank a remote tail separately and
    // append it. The local order is then a function of the local hits alone and
    // cannot change when the network answers.
    const tokens = ['kirkland', 'salmon'];
    const localHits = [
      hit(food('k', 'Salmon', 'Kirkland')),
      hit(reference('u', 'Fish, salmon, chinook, raw')),
    ];
    const localOrder = rerank(localHits, tokens).map((h) => h.food.id);
    const tail = rerank([hit(food('r', 'Kirkland Style Bake', 'Someone Else'))], tokens);

    expect([...localOrder, ...tail.map((h) => h.food.id)]).toEqual(['k', 'u', 'r']);
    expect(rerank(localHits, tokens).map((h) => h.food.id)).toEqual(localOrder);
  });
});

describe('a brand field that is just echoing the product name', () => {
  // Open Food Facts is contributor-entered, and the shipped index really does
  // contain a record named "Milk" whose brand is "Milk", and one named "Chicken
  // Breast" whose brand is "Chicken Breast ALDI". Both used to collect the full
  // brand bonus and take position one from the record that IS milk.
  const tokens = ['milk'];

  it('earns no brand bonus, because it distinguishes nothing', () => {
    const echo = hitFeatures(food('a', 'Milk', 'Milk'), tokens);
    expect(echo.brandNamed).toBe(0);
    expect(echo.brandCoverage).toBe(0);
  });

  it('catches a brand that pads the name rather than repeating it exactly', () => {
    const padded = hitFeatures(food('a', 'Chicken Breast', 'Chicken Breast ALDI'), [
      'chicken',
      'breast',
    ]);
    expect(padded.brandNamed).toBe(0);
  });

  it('leaves a real brand alone', () => {
    const real = hitFeatures(food('a', 'Gold Standard Whey', 'Optimum Nutrition'), [
      'optimum',
      'nutrition',
    ]);
    expect(real.brandNamed).toBe(1);
  });

  it('withholds a bonus without hiding the food', () => {
    // It still ranks on its name — "COCA-COLA | Cola" is caught by this rule
    // (the name is one of the brand's words) and is still on the first screen
    // for "cola" in the shipped index. Suppressing a bonus is not a filter.
    const echo = hitFeatures(food('a', 'Cola', 'COCA-COLA'), ['cola']);
    expect(echo.brandNamed).toBe(0);
    expect(echo.nameCoverage).toBe(1);
    expect(echo.exactName).toBe(1);
  });

  it('puts the plain reference food above a name-echoing brand', () => {
    expect(rerank(
      [hit(food('echo', 'Milk', 'Milk')), hit(reference('plain', 'Milk, whole, 3.25% milkfat'))],
      tokens,
    ).map((h) => h.food.id)).toEqual(['plain', 'echo']);
  });
});
