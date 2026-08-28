import { fold, tokenise } from '@freeforever/datasets';

/**
 * Query classification and client-side re-ranking.
 *
 * Two problems this solves, both measured against the committed index build
 * rather than assumed.
 *
 * **1. Dead queries look like missing food.** The index folds queries through
 * the same `tokenise()` it built its terms with, which drops stopwords and
 * single characters. So `"the"`, `"de"`, `"or"` and `"c"` all produce zero
 * tokens and therefore zero results — not because the food is missing but
 * because nothing was asked. Rendering that as "no results found" tells the
 * user a lie about the data. `classifyQuery` separates the two so the UI can
 * say "keep typing" instead.
 *
 * This is also the honest answer to the reported ~4.4% recall shortfall on Open
 * Food Facts records: probing those records by the first word of their *display
 * name* fails for exactly the 13 fixture rows whose names open with a stopword
 * ("The Madelaine Chocolate Company", "De Nigris"). Probed by their first
 * *indexed* term they are all findable, which is what the datasets verifier now
 * checks. Nothing is missing from the index; a query consisting only of a
 * stopword is simply not a query.
 *
 * **2. A common leading token buries a specific food.** The index ranks by term
 * weight plus record order. Searching `"raw"` against the core shard, 80 of 486
 * records do not appear in the top 20 — "Raw blueberries" loses to every other
 * food whose name also opens with "raw". The index is right; twenty is just too
 * few. So the query path over-fetches and re-ranks locally, which costs
 * microseconds and no bytes.
 */

export type QueryKind =
  | 'empty'
  /** Something was typed, but nothing in it is indexable yet. */
  | 'not_yet_searchable'
  | 'ready';

export interface ClassifiedQuery {
  kind: QueryKind;
  /** Tokens as the index will see them. Empty unless `kind` is `ready`. */
  tokens: string[];
  raw: string;
}

/**
 * Decide whether a query can return anything, using the index's own tokeniser
 * so the answer cannot disagree with what the index will do.
 */
export function classifyQuery(raw: string): ClassifiedQuery {
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'empty', tokens: [], raw };
  const tokens = tokenise(trimmed);
  if (tokens.length === 0) return { kind: 'not_yet_searchable', tokens: [], raw };
  return { kind: 'ready', tokens, raw };
}

/**
 * How many hits to pull from the index before re-ranking.
 *
 * Chosen against the measurement above: at the default limit of 20, 16.5% of
 * core records cannot find themselves by their own leading term. Over-fetching
 * to 200 and re-ranking locally clears it, and the index only materialises the
 * records it returns, so the cost is a few hundred microseconds of decode.
 */
export const OVERFETCH_LIMIT = 200;

/** The minimum a `RankableHit`'s food must expose. Structural, so tests need no index. */
export interface RankableFood {
  id: string;
  name: string;
  brand: string | null;
  shard?: string;
  flags?: { highConfidence?: boolean; energyDerived?: boolean; servingEstimated?: boolean };
}

export interface RankableHit<F extends RankableFood = RankableFood> {
  food: F;
  score: number;
}

/* Weights. Tuned so a whole-word name match always beats a prefix-only brand
 * match, and so the index's own opinion still breaks ties among equals. */
const W_INDEX = 1.0;
const W_NAME_COVERAGE = 2.5;
const W_NAME_PREFIX = 1.2;
const W_BREVITY = 0.8;
const W_CONFIDENCE = 0.15;
const W_BRAND_ONLY_PENALTY = 0.5;

/**
 * Score one hit against the query, on top of the index's own score.
 *
 * The index score is normalised within the result set before it is mixed in,
 * because it is only comparable within one set — the format contract says so
 * explicitly, and treating it as an absolute would make the blend depend on how
 * selective the query happened to be.
 */
export function rankScore(
  hit: RankableHit,
  tokens: readonly string[],
  normalisedIndexScore: number,
): number {
  const nameTokens = tokenise(hit.food.name);
  const nameSet = new Set(nameTokens);
  const brandTokens = new Set(hit.food.brand !== null ? tokenise(hit.food.brand) : []);

  let matchedInName = 0;
  let matchedInBrandOnly = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    const isLast = i === tokens.length - 1;
    // The index treats the final token as a prefix, so re-ranking must too or a
    // food would score zero coverage on the word the user is mid-way through.
    const inName = isLast
      ? nameTokens.some((t) => t.startsWith(token))
      : nameSet.has(token);
    if (inName) {
      matchedInName++;
      continue;
    }
    const inBrand = isLast
      ? [...brandTokens].some((t) => t.startsWith(token))
      : brandTokens.has(token);
    if (inBrand) matchedInBrandOnly++;
  }

  const coverage = tokens.length === 0 ? 0 : matchedInName / tokens.length;

  // Does the name *open* with what was typed? "Raw blueberries" for "raw".
  const first = tokens[0];
  const prefixBonus = first !== undefined && (nameTokens[0]?.startsWith(first) ?? false) ? 1 : 0;

  // Prefer the shorter, more specific name. "Flour, semolina, coarse and
  // semi-coarse" is a worse answer to "flour" than "Flour, wheat, white".
  const brevity = 1 / (1 + Math.max(0, nameTokens.length - tokens.length));

  const confidence = hit.food.flags?.highConfidence === true ? 1 : 0;
  const brandOnly = tokens.length === 0 ? 0 : matchedInBrandOnly / tokens.length;

  return (
    W_INDEX * normalisedIndexScore +
    W_NAME_COVERAGE * coverage +
    W_NAME_PREFIX * prefixBonus +
    W_BREVITY * brevity +
    W_CONFIDENCE * confidence -
    W_BRAND_ONLY_PENALTY * brandOnly
  );
}

/**
 * Re-rank an over-fetched result set. Does not truncate — truncation happens
 * after deduplication, or the display limit gets spent on rows that are then
 * collapsed and the list comes back short.
 *
 * Stable and deterministic: ties break on the index's own order, then on id, so
 * the list does not shuffle between identical keystrokes.
 */
export function rerank<F extends RankableFood>(
  hits: readonly RankableHit<F>[],
  tokens: readonly string[],
): RankableHit<F>[] {
  if (hits.length === 0) return [];
  const max = Math.max(...hits.map((h) => h.score));
  const norm = max > 0 ? max : 1;

  const scored = hits.map((hit, index) => ({
    hit,
    index,
    score: rankScore(hit, tokens, hit.score / norm),
  }));

  scored.sort((a, b) => b.score - a.score || a.index - b.index || a.hit.food.id.localeCompare(b.hit.food.id));
  return scored.map((s) => s.hit);
}

/**
 * Collapse rows that are the same food twice.
 *
 * The core and OFF shards are built from different upstreams and deduped
 * independently, so a branded product can legitimately appear in both. Showing
 * it twice makes the user choose between two identical rows, which is a tap
 * spent on nothing. The first occurrence wins, so this must run *after*
 * re-ranking — the better-ranked copy is the one kept.
 */
export function dedupeHits<F extends RankableFood>(
  hits: readonly RankableHit<F>[],
): RankableHit<F>[] {
  const seen = new Set<string>();
  const out: RankableHit<F>[] = [];
  for (const hit of hits) {
    const key = `${fold(hit.food.name)}|${fold(hit.food.brand ?? '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

/**
 * The whole query path: classify, over-fetch, dedupe, re-rank, cut.
 *
 * `runSearch` is injected rather than imported so this stays a pure function of
 * its inputs and can be tested without loading a 4 MB index.
 */
export function searchFoods<F extends RankableFood>(
  runSearch: (query: string, opts: { limit: number }) => RankableHit<F>[],
  raw: string,
  limit = 25,
): { query: ClassifiedQuery; hits: RankableHit<F>[] } {
  const query = classifyQuery(raw);
  if (query.kind !== 'ready') return { query, hits: [] };
  const found = runSearch(query.raw, { limit: OVERFETCH_LIMIT });
  // Rank, then collapse duplicates, then cut. In that order: the better-ranked
  // copy of a duplicated food is the one that survives, and the display limit
  // is spent on distinct foods rather than on rows about to be collapsed.
  return { query, hits: dedupeHits(rerank(found, query.tokens)).slice(0, limit) };
}
