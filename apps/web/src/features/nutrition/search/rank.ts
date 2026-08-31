import { fold, tokenise } from '@freeforever/datasets';

/**
 * Query classification and client-side re-ranking.
 *
 * Every figure quoted in this file was measured against the shipped index —
 * version 2026.08.1, 95,885 records (core 32,117 + off 63,768), manifest
 * 2026-08-31T15:18Z — by `recall.test.ts`, which refuses to report a number if
 * the build directory holds a sample. **The corpus identity is stated wherever a number is, on
 * purpose:** an earlier version of these comments carried figures from the
 * pre-dedupe 98,267-record build and there was no way to tell by reading them.
 * A measurement without its corpus is a rumour.
 *
 * Three problems this file solves, and one seam it leaves open.
 *
 * **1. Dead queries look like missing food.** The index folds queries through
 * the same `tokenise()` it built its terms with, which drops stopwords and
 * single characters. So `"the"`, `"de"`, `"or"` and `"c"` all produce zero
 * tokens and therefore zero results — not because the food is missing but
 * because nothing was asked. Rendering that as "no results found" tells the
 * user a lie about the data. `classifyQuery` separates the two so the UI can
 * say "keep typing" instead.
 *
 * **2. A common word buries the specific food.** The index cuts to `limit`
 * before anything here can see the results, so the query path over-fetches to
 * `OVERFETCH_LIMIT` and re-ranks locally. That costs microseconds and no bytes:
 * the index only materialises the records it returns.
 *
 * **3. A common word surfaced the wrong *kind* of food.** This is the one the
 * corpus growing 122-fold exposed. Over 784 records "milk" returned a handful
 * of rows and the plain one was visible; over 97,000 it returned three
 * supermarket own-brand cartons followed by milk crackers, milk chocolate
 * candies and a milkshake — while the record that *is* milk sat inside the
 * candidate pool the whole time, never lower than position 116 and now at 3.
 * That is worth remembering as a diagnostic: when the right answer is already
 * in the pool, the fetch is not the problem and deepening it will not help.
 * The signals that fix it are `headExact` (a USDA name is
 * head-then-qualifiers, so "Milk, whole, 3.25% milkfat" IS milk), a
 * `reference` bonus for unbranded USDA records, `brandIntent` to gate that
 * bonus off when the user names a brand, and `diversifyByName` to stop a dozen
 * rows reading the same word from owning the first screen. Measured on the
 * corpus above, over 31 generic queries: the plain food reached the first
 * screen 15 times out of 31 before, 31 out of 31 after.
 *
 * ## The seam for a second source
 *
 * Nothing here imports the index. `searchFoods` takes `runSearch` as a
 * parameter and `rerank`, `dedupeHits` and `diversifyByName` are pure functions
 * over an array of `{food, score}`. A second source — a remote lookup for the
 * 407,215 records that passed every quality gate and were then dropped at the
 * 4 MB budget — is therefore a matter of producing more hits, not of rewriting
 * this file.
 *
 * **But two quantities here are relative to the set they are scored in, and
 * both would reorder a list that is already on screen if a second batch were
 * merged into the first:**
 *
 *   - the index score is normalised by the batch maximum (`hit.score / max`),
 *     because the format contract says a score is comparable only within one
 *     result set. Two sources with different score scales sharing one
 *     normalisation would systematically favour whichever emits bigger numbers.
 *   - `brandIntent` is derived from the whole pool. One remote hit with
 *     "kirkland" in its *name* is enough to stop "kirkland" counting as a brand
 *     word, which flips the gate and re-scores every local hit.
 *
 * So a remote tail must be **ranked as its own set and appended**, never merged
 * into a ranked local list and re-sorted. That is also the right answer for the
 * user holding a phone: a list that reorders under the thumb after a network
 * response is worse than no fallback at all. `rank.test.ts` pins both hazards
 * as facts so whoever builds the fallback meets them here rather than in
 * production.
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
  /** `usda-foundation` | `usda-sr-legacy` | `usda-branded` | `off`. Drives the reference-food signal. */
  source?: string;
  flags?: { highConfidence?: boolean; energyDerived?: boolean; servingEstimated?: boolean };
}

export interface RankableHit<F extends RankableFood = RankableFood> {
  food: F;
  score: number;
}

/**
 * The unbranded USDA reference records — lab-analysed Foundation foods and the
 * Standard Reference legacy set.
 *
 * These are the answer to "milk", "rice", "chicken breast". They are also the
 * records that lose hardest without help, because their names are long and
 * comma-shaped ("Chicken, broilers or fryers, breast, meat only, raw") while
 * the branded rows competing with them are two words ("Chicken Breast"). Any
 * scoring that rewards a short name buries the reference food, every time.
 */
const REFERENCE_SOURCES = new Set(['usda-foundation', 'usda-sr-legacy']);

/**
 * What one candidate looks like against one query. Extracted from the scoring
 * so it can be asserted directly — a weight is an opinion, but "does this hit
 * lead with the words the user typed" is a fact.
 */
export interface HitFeatures {
  /** Query tokens found in the name, over query length. */
  nameCoverage: number;
  /** Query tokens found in the brand and not the name, over query length. */
  brandCoverage: number;
  /** The brand's *own* tokens that the query names, over the brand's length. */
  brandNamed: number;
  /** How much of the query matches an unbroken run at the *start* of the name. */
  leadingRun: number;
  /** The name is exactly the query, no more words. */
  exactName: number;
  /**
   * The name's *head clause* — everything before the first comma — is exactly
   * the query.
   *
   * USDA writes a food as head-then-qualifiers: "Milk, whole, 3.25% milkfat",
   * "Rice, white, long-grain, regular, raw". The head is the food's actual
   * name and the rest is which variety. Without this, the record that IS milk
   * looks like a four-word partial match and loses to any branded carton
   * literally named "Milk" — which is how "milk" returned three supermarket
   * own-brands and then milk crackers.
   */
  headExact: number;
  /** Name tokens the query accounts for, over the name's length. */
  nameTightness: number;
  /** An unbranded USDA reference food — the generic entry for a whole food. */
  reference: number;
  /** Lab-analysed USDA Foundation. There are only 342, and they are the staples. */
  foundation: number;
  confidence: number;
}

/** Prefix-aware token match. The index treats the query's last token as a prefix. */
function matches(candidate: readonly string[], token: string, asPrefix: boolean): boolean {
  return asPrefix ? candidate.some((t) => t.startsWith(token)) : candidate.includes(token);
}

/**
 * The intermediate a hit produces: its features, plus the raw matching detail
 * the *set-level* brand-intent decision needs. Kept separate from `HitFeatures`
 * so the public feature vector stays a flat bag of numbers.
 */
export interface HitAnalysis {
  features: HitFeatures;
  /** Per query token: did it match this food's name? */
  nameMatched: readonly boolean[];
  /** Per brand token: index of the query token that named it, or -1. */
  brandNamedBy: readonly number[];
}

/**
 * True when the brand field is just echoing the product name.
 *
 * Open Food Facts is contributor-entered and the brand field collects the
 * product name often enough to matter: the shipped index has a record named
 * "Milk" whose brand is "Milk", and one named "Chicken Breast" whose brand is
 * "Chicken Breast ALDI". Both then collect the full brand bonus for the query
 * "milk" or "chicken breast" and take position one from the record that IS
 * milk.
 *
 * A brand that contains the whole of the food's name distinguishes nothing, so
 * it earns no brand bonus. Detected structurally rather than from a list of bad
 * brands, because the list would be endless and would go stale on every
 * rebuild. This only withholds a bonus — such a record still ranks on its name.
 */
function brandEchoesName(nameTokens: readonly string[], brandTokens: readonly string[]): boolean {
  if (nameTokens.length === 0 || brandTokens.length === 0) return false;
  return nameTokens.every((t) => brandTokens.includes(t));
}

export function analyseHit(food: RankableFood, tokens: readonly string[]): HitAnalysis {
  const nameTokens = tokenise(food.name);
  const headTokens = tokenise(food.name.split(',')[0] ?? food.name);
  const rawBrandTokens = food.brand !== null ? tokenise(food.brand) : [];
  const brandTokens = brandEchoesName(nameTokens, rawBrandTokens) ? [] : rawBrandTokens;
  const last = tokens.length - 1;

  let inName = 0;
  let inBrandOnly = 0;
  const matchedNameTokens = new Set<string>();
  const nameMatched: boolean[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    const asPrefix = i === last;
    const hit = matches(nameTokens, token, asPrefix);
    nameMatched.push(hit);
    if (hit) {
      inName++;
      for (const t of nameTokens) if (asPrefix ? t.startsWith(token) : t === token) matchedNameTokens.add(t);
      continue;
    }
    if (matches(brandTokens, token, asPrefix)) inBrandOnly++;
  }

  // How much of the brand the query actually names. `"optimum nutrition"` names
  // all of Optimum Nutrition; `"nutrition"` alone names half of it, which is
  // the difference between meaning the brand and using one of its words.
  const brandNamedBy: number[] = [];
  let brandTokensNamed = 0;
  for (const brandToken of brandTokens) {
    const by = tokens.findIndex((token, i) =>
      i === last ? brandToken.startsWith(token) : brandToken === token,
    );
    brandNamedBy.push(by);
    if (by >= 0) brandTokensNamed++;
  }

  // An unbroken run from the start of the name. This is what separates
  // "Gold Standard 100% Whey" from "Double Rich Chocolate Gold Standard Whey"
  // for the query "gold standard": both contain the words, one leads with them.
  let run = 0;
  while (run < tokens.length && run < nameTokens.length) {
    const token = tokens[run] as string;
    const nameToken = nameTokens[run] as string;
    const ok = run === last ? nameToken.startsWith(token) : nameToken === token;
    if (!ok) break;
    run++;
  }

  // Same run, against the head clause only.
  let headRun = 0;
  while (headRun < tokens.length && headRun < headTokens.length) {
    const token = tokens[headRun] as string;
    const headToken = headTokens[headRun] as string;
    if (!(headRun === last ? headToken.startsWith(token) : headToken === token)) break;
    headRun++;
  }

  const n = tokens.length;
  const features: HitFeatures = {
    nameCoverage: n === 0 ? 0 : inName / n,
    brandCoverage: n === 0 ? 0 : inBrandOnly / n,
    brandNamed: brandTokens.length === 0 ? 0 : brandTokensNamed / brandTokens.length,
    leadingRun: n === 0 ? 0 : run / n,
    exactName: run === n && nameTokens.length === n ? 1 : 0,
    headExact: headRun === n && headTokens.length === n ? 1 : 0,
    nameTightness: nameTokens.length === 0 ? 0 : matchedNameTokens.size / nameTokens.length,
    reference:
      food.brand === null && food.source !== undefined && REFERENCE_SOURCES.has(food.source) ? 1 : 0,
    foundation: food.brand === null && food.source === 'usda-foundation' ? 1 : 0,
    confidence: food.flags?.highConfidence === true ? 1 : 0,
  };
  return { features, nameMatched, brandNamedBy };
}

/** The feature vector alone. */
export function hitFeatures(food: RankableFood, tokens: readonly string[]): HitFeatures {
  return analyseHit(food, tokens).features;
}

/**
 * Weights, in one object so they can be swept rather than argued about.
 *
 * Every number here was chosen by measuring recall and top-8 precision against
 * the shipped 95,885-record index — see `recall.test.ts`, which reports both
 * and fails if the corpus it opens is not the one we ship. The previous set was
 * tuned against 784 records and did not survive the corpus growing 122-fold;
 * that is the whole reason this object is exported.
 */
export interface RankWeights {
  index: number;
  exactName: number;
  headExact: number;
  leadingRun: number;
  nameCoverage: number;
  brandCoverage: number;
  brandNamed: number;
  nameTightness: number;
  reference: number;
  foundation: number;
  confidence: number;
}

export const DEFAULT_WEIGHTS: RankWeights = {
  /**
   * The index's own opinion, normalised within the result set.
   *
   * Small, and **staying small on the evidence, not on a hunch.**
   *
   * This was 1.0, against a 784-record sample where the index's popularity prior
   * — `0.5 / (1 + doc / 500)`, with 500 hard-coded — spanned 0.5 down to 0.31
   * and carried real information. Over 95,885 records that form collapsed to ~0
   * by record 5,000, so a third of the score was being spent on a number that
   * was flat across most of the corpus.
   *
   * The reader now decays over log rank normalised by corpus size, and record
   * order itself was fixed upstream, so the prior is a real signal again — and
   * the obvious next move was to raise this back up. **Swept 0, 0.5, 1, 1.5, 2
   * and 3 on the rebuilt corpus: staples stay at 100%, brand recall moves by a
   * tenth of a point, name recall does not move at all.** The weight is simply
   * not load-bearing once the text signals below are doing their job, because
   * the index score has already decided *which* 200 candidates arrive and this
   * only reorders within them.
   *
   * Kept non-zero so the index keeps a say in ties. Do not raise it without
   * re-running that sweep: "the prior got better, so the weight should go up"
   * sounds right and measures as nothing.
   */
  index: 0.5,
  /** Typed the food's exact name. Nothing should outrank that. */
  exactName: 2.2,
  /**
   * Worth nearly as much as an exact whole-name match, because for a USDA
   * record it *is* one. "Rice, white, long-grain, regular, raw" is the food
   * called rice.
   */
  headExact: 1.8,
  leadingRun: 2,
  nameCoverage: 3,
  /**
   * Brand matches are worth *less* than name matches but they are worth
   * something. They used to be worth minus 0.5: `rankScore` computed the
   * brand-only match fraction and subtracted it, so typing "optimum nutrition"
   * actively pushed every Optimum Nutrition product down and let any food with
   * "nutrition" in its *name* win. That is the sign error behind "I should just
   * be able to select Optimum Nutrition".
   */
  brandCoverage: 1.2,
  brandNamed: 1.5,
  nameTightness: 0.6,
  reference: 3,
  foundation: 0.8,
  confidence: 0.3,
};

/**
 * How much the query looks like it names a brand, from 0 to 1.
 *
 * Measured over the candidate pool rather than guessed from a word list: a
 * query token counts only when it matches some candidate's *brand* and not its
 * name, which is what makes a word a brand rather than a food. "kirkland" is
 * only ever a brand; "salmon" is a food that some brands also print on a
 * packet.
 *
 * This gates the reference-food bonus, and the gate is the whole reason the
 * bonus can be large. "salmon" should surface USDA's plain fish above a dozen
 * supermarket fillets; "kirkland salmon" must not. Without the gate, one weight
 * has to serve both and serves neither.
 */
export function brandIntent(analyses: readonly HitAnalysis[], tokenCount: number): number {
  if (analyses.length === 0) return 0;

  // A query token is brand-exclusive when it names a brand somewhere in the
  // pool and appears in no food's *name* anywhere in the pool. "kirkland" is
  // exclusive; "greek" and "yogurt" are not, however many brands print them on
  // a tub. Without this the gate misfired on "greek yogurt" — some brand is
  // literally called Greek Yogurt — and suppressed the very bonus that surfaces
  // USDA's plain Greek yogurt.
  const seenInSomeName = new Array<boolean>(tokenCount).fill(false);
  for (const a of analyses) {
    for (let i = 0; i < tokenCount; i++) if (a.nameMatched[i] === true) seenInSomeName[i] = true;
  }

  let strongest = 0;
  for (const a of analyses) {
    const brandTokens = a.brandNamedBy.length;
    if (brandTokens === 0) continue;
    let exclusivelyNamed = 0;
    for (const by of a.brandNamedBy) {
      if (by >= 0 && seenInSomeName[by] !== true) exclusivelyNamed++;
    }
    const strength = exclusivelyNamed / brandTokens;
    if (strength > strongest) strongest = strength;
  }
  return Math.min(1, strongest);
}

/**
 * Score one hit against the query, on top of the index's own score.
 *
 * The index score is normalised within the result set before it is mixed in,
 * because it is only comparable within one set — the format contract says so
 * explicitly, and treating it as an absolute would make the blend depend on how
 * selective the query happened to be.
 *
 * `referenceGate` is `1 - brandIntent` for the whole result set. Pass 1 when
 * scoring a single hit in isolation.
 */
export function scoreFeatures(
  f: HitFeatures,
  normalisedIndexScore: number,
  referenceGate: number,
  weights: RankWeights = DEFAULT_WEIGHTS,
): number {
  return (
    weights.index * normalisedIndexScore +
    weights.exactName * f.exactName +
    weights.headExact * f.headExact +
    weights.leadingRun * f.leadingRun +
    weights.nameCoverage * f.nameCoverage +
    weights.brandCoverage * f.brandCoverage +
    weights.brandNamed * f.brandNamed +
    weights.nameTightness * f.nameTightness +
    referenceGate * (weights.reference * f.reference + weights.foundation * f.foundation) +
    weights.confidence * f.confidence
  );
}

/** Convenience wrapper: features and score for one hit, ungated. */
export function rankScore(
  hit: RankableHit,
  tokens: readonly string[],
  normalisedIndexScore: number,
  weights: RankWeights = DEFAULT_WEIGHTS,
): number {
  return scoreFeatures(hitFeatures(hit.food, tokens), normalisedIndexScore, 1, weights);
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
  weights: RankWeights = DEFAULT_WEIGHTS,
): RankableHit<F>[] {
  if (hits.length === 0) return [];
  const max = Math.max(...hits.map((h) => h.score));
  const norm = max > 0 ? max : 1;

  // Features once per hit: the brand-intent gate is a property of the whole
  // result set, so it cannot be computed inside the per-hit score.
  const analyses = hits.map((h) => analyseHit(h.food, tokens));
  const gate = 1 - brandIntent(analyses, tokens.length);

  const scored = hits.map((hit, index) => ({
    hit,
    index,
    score: scoreFeatures(
      (analyses[index] as HitAnalysis).features,
      hit.score / norm,
      gate,
      weights,
    ),
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
 * How many rows reading the same name may sit at the front of the list.
 *
 * Eight rows all reading "Greek Yogurt", differing only in a supermarket's
 * name, are one row's worth of information occupying a whole screen — and they
 * were pushing the plain USDA record off it entirely.
 *
 * **Five, measured, not guessed.** Against the shipped index (95,885 records),
 * over 31 generic staple queries and an 800-record recall sample:
 *
 * | cap | plain food on the first screen | the name typed out, @8 |
 * |-----|-------------------------------|------------------------|
 * | off |  81%                          | 96.3%                  |
 * |  2  | 100%                          | 91.1%                  |
 * |  5  | 100%                          | 94.9%                  |
 * |  6  | 100%                          | 95.5%                  |
 * |  8  |  81%                          | 96.3%                  |
 *
 * So 2 gave away four points of recall for nothing, and 8 is past the cliff —
 * with eight rows on screen a cap of eight is no cap. 6 measures 0.6 points
 * better than 5 and sits one step from that cliff, which is not where a shipped
 * constant belongs. 5 keeps two rows of margin and the same staple figure.
 *
 * This table has now been re-measured across three index rebuilds and the shape
 * has not moved, which is the main reason to trust the choice rather than the
 * individual percentages.
 */
export const MAX_SAME_NAME_UP_FRONT = 5;

/**
 * Move the third and subsequent rows sharing a name to the back of the list.
 *
 * **Demotes, never drops.** An earlier version of this cut them, and at a cap
 * of two it cost seven and a half points of recall for a food whose name a
 * dozen supermarkets also use —
 * worse, it made a longer list useless, because the rows a user scrolled for
 * had been deleted rather than deferred. Now the first screen is diverse and
 * the twelfth "Salmon" is still the twelfth result rather than no result.
 *
 * Runs after re-ranking, so the copies promoted are the best-ranked ones, and
 * relative order is preserved within both groups.
 */
export function diversifyByName<F extends RankableFood>(
  hits: readonly RankableHit<F>[],
  max = MAX_SAME_NAME_UP_FRONT,
): RankableHit<F>[] {
  const seen = new Map<string, number>();
  const front: RankableHit<F>[] = [];
  const back: RankableHit<F>[] = [];
  for (const hit of hits) {
    const key = fold(hit.food.name);
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    (count < max ? front : back).push(hit);
  }
  return [...front, ...back];
}

/**
 * The whole query path: classify, over-fetch, re-rank, dedupe, diversify, cut.
 *
 * The order is load-bearing at every step:
 *
 *   - re-rank *before* dedupe, so the copy of a duplicated food that survives
 *     is the better-ranked one;
 *   - dedupe *before* diversify, so identical rows are merged rather than
 *     merely deferred;
 *   - cut *last*, so the display limit is spent on distinct foods rather than
 *     on rows that were about to be collapsed.
 *
 * `runSearch` is injected rather than imported so this stays a pure function of
 * its inputs and can be tested without loading a 4 MB index.
 */
export function searchFoods<F extends RankableFood>(
  runSearch: (query: string, opts: { limit: number }) => RankableHit<F>[],
  raw: string,
  limit = 25,
  weights: RankWeights = DEFAULT_WEIGHTS,
): { query: ClassifiedQuery; hits: RankableHit<F>[] } {
  const query = classifyQuery(raw);
  if (query.kind !== 'ready') return { query, hits: [] };
  const found = runSearch(query.raw, { limit: OVERFETCH_LIMIT });
  const ranked = diversifyByName(dedupeHits(rerank(found, query.tokens, weights)));
  return { query, hits: ranked.slice(0, limit) };
}
