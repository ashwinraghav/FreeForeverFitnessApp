import type { CatalogueEntry } from './types.js';

/**
 * Exercise search: offline, on-device, and fast enough to run on every keystroke.
 *
 * The whole design brief is one line: the lifter is typing with one chalky thumb, out
 * of breath, and every character they do not have to type is worth more than any
 * ranking cleverness. So:
 *
 *   - **Recent lifts come first when the box is empty.** Most sessions repeat a
 *     handful of movements. The fastest search is the one nobody types.
 *   - **The last token is a prefix.** "inc db" matches "Incline Dumbbell Press" after
 *     six characters, and every intermediate state matches too, so the list narrows
 *     as they type instead of going blank and coming back.
 *   - **Aliases are first-class.** Nobody types "Romanian Deadlift". They type "rdl".
 *   - **Accents fold.** So do hyphens and apostrophes: "pull up", "pull-up" and
 *     "pullup" are the same query, and "farmers" finds "Farmer's Carry".
 *
 * A linear scan over a few hundred entries is well under a millisecond, so there is
 * no index to build, invalidate or ship. If the catalogue grows past a few thousand
 * this wants an inverted index; it does not want one yet.
 */

export interface SearchHit {
  readonly entry: CatalogueEntry;
  readonly score: number;
}

export interface SearchOptions {
  readonly limit?: number;
  /** Exercise ids in most-recently-used order. Ranked above equally good matches. */
  readonly recentIds?: readonly string[];
  /**
   * Ids to float to the very top of an empty query, from `recommendedExerciseIds`.
   * Ignored once the lifter types: they have said what they want, and relevance wins.
   */
  readonly recommendedIds?: readonly string[];
  /** Show only these equipment kinds. Empty or absent means all. */
  readonly equipment?: readonly string[];
  /** Show only exercises that train this muscle at all. */
  readonly muscle?: string;
}

export const DEFAULT_SEARCH_LIMIT = 40;

/**
 * Lowercase, strip diacritics, and reduce every run of non-alphanumerics to one space.
 *
 * The `NFD` decomposition splits "é" into "e" plus a combining accent, which the range
 * then removes — so an accented catalogue entry is reachable from an unaccented
 * keyboard, which is most keyboards in a gym.
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenise(text: string): string[] {
  const folded = fold(text);
  return folded === '' ? [] : folded.split(' ');
}

export interface Indexed {
  readonly entry: CatalogueEntry;
  readonly name: string;
  readonly nameTokens: readonly string[];
  readonly aliases: readonly string[];
  readonly aliasTokens: readonly string[];
}

/**
 * Pre-fold a catalogue once so a keystroke does not re-normalise every entry.
 *
 * Memoised on the array identity: the catalogue is a module constant, so in practice
 * this runs exactly once per session however many times the picker is opened.
 */
const indexCache = new WeakMap<readonly CatalogueEntry[], readonly Indexed[]>();

export function indexCatalogue(catalogue: readonly CatalogueEntry[]): readonly Indexed[] {
  const cached = indexCache.get(catalogue);
  if (cached !== undefined) return cached;

  const built: Indexed[] = catalogue.map((entry) => {
    const name = fold(entry.name);
    const aliases = entry.aliases.map(fold);
    return {
      entry,
      name,
      nameTokens: name === '' ? [] : name.split(' '),
      aliases,
      aliasTokens: aliases.flatMap((alias) => (alias === '' ? [] : alias.split(' '))),
    };
  });

  indexCache.set(catalogue, built);
  return built;
}

/**
 * Search. Tokens are ANDed and the final token is treated as a prefix, so this is
 * safe and stable to call on every keystroke.
 */
export function searchExercises(
  query: string,
  catalogue: readonly CatalogueEntry[],
  options: SearchOptions = {},
): SearchHit[] {
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  const indexed = indexCatalogue(catalogue).filter((item) => passesFilters(item.entry, options));
  const recentRank = rankMap(options.recentIds ?? []);
  const tokens = tokenise(query);

  if (tokens.length === 0) {
    /*
     * Empty query is the browsing case: recommended, then recents, then the catalogue
     * in its own order.
     *
     * That last tier used to be alphabetical, which was fine for 70 hand-written
     * entries and became actively bad at ~900: the picker opened on "3/4 Sit-Up" and
     * "90/90 Hamstring" and buried every lift anybody actually does. Catalogue order is
     * the better key because `mergeCatalogues` already puts the curated seventy first
     * and the dataset — which is itself alphabetical — after them. So the common lifts
     * lead, and no new notion of "important" has to be invented or maintained.
     */
    const recommendedRank = rankMap(options.recommendedIds ?? []);
    const position = new Map(indexed.map((item, index) => [item.entry.id, index]));
    const tierOf = (id: string): number =>
      recommendedRank.get(id) ?? recentRank.get(id) ?? Number.POSITIVE_INFINITY;

    return [...indexed]
      .sort((left, right) => {
        // Recommended above recent, both above the rest, each in their own order.
        const leftGroup = recommendedRank.has(left.entry.id) ? 0 : recentRank.has(left.entry.id) ? 1 : 2;
        const rightGroup = recommendedRank.has(right.entry.id) ? 0 : recentRank.has(right.entry.id) ? 1 : 2;
        if (leftGroup !== rightGroup) return leftGroup - rightGroup;
        if (leftGroup < 2) return tierOf(left.entry.id) - tierOf(right.entry.id);
        return (position.get(left.entry.id) ?? 0) - (position.get(right.entry.id) ?? 0);
      })
      .slice(0, limit)
      .map((item) => ({
        entry: item.entry,
        score: recommendedRank.has(item.entry.id) ? 2 : recentRank.has(item.entry.id) ? 1 : 0,
      }));
  }

  const hits: SearchHit[] = [];
  for (const item of indexed) {
    const score = scoreOf(item, tokens);
    if (score <= 0) continue;
    // A recent lift wins any tie with an equally good match it has never done.
    const rank = recentRank.get(item.entry.id);
    hits.push({ entry: item.entry, score: score + (rank === undefined ? 0 : 5 - Math.min(4, rank)) });
  }

  return hits
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      // Shorter name wins: "Dip" before "Dip (Assisted)" for the query "dip".
      if (left.entry.name.length !== right.entry.name.length) {
        return left.entry.name.length - right.entry.name.length;
      }
      return left.entry.name < right.entry.name ? -1 : 1;
    })
    .slice(0, limit);
}

/**
 * How well one entry matches. Zero means no match — every token must hit something.
 *
 * The weights encode one judgement: a lifter who types "bench" wants Bench Press at
 * the top, not Close-Grip Bench Press, so matching the *start of the name* beats
 * matching a word in the middle, which beats matching an alias.
 */
function scoreOf(item: Indexed, tokens: readonly string[]): number {
  let total = 0;

  for (const [index, token] of tokens.entries()) {
    const isLast = index === tokens.length - 1;
    const tokenScore = scoreToken(item, token, isLast);
    // Tokens are ANDed: "incline row" must not match Incline Bench Press.
    if (tokenScore === 0) return 0;
    total += tokenScore;
  }

  const whole = tokens.join(' ');
  if (item.name === whole) total += 100;
  else if (item.name.startsWith(`${whole} `)) total += 40;
  if (item.aliases.includes(whole)) total += 60;

  return total;
}

function scoreToken(item: Indexed, token: string, allowPrefix: boolean): number {
  const exact = (candidates: readonly string[]) => candidates.includes(token);
  const prefixed = (candidates: readonly string[]) =>
    allowPrefix && candidates.some((candidate) => candidate.startsWith(token));

  if (item.nameTokens[0] === token) return 20;
  if (allowPrefix && item.nameTokens[0]?.startsWith(token) === true) return 16;
  if (exact(item.nameTokens)) return 12;
  if (prefixed(item.nameTokens)) return 9;
  if (exact(item.aliasTokens)) return 8;
  if (prefixed(item.aliasTokens)) return 6;
  // Last resort: a substring anywhere. Catches "press" inside a compound word and
  // keeps the list from going empty on a plausible query.
  if (item.name.includes(token)) return 2;
  if (item.aliases.some((alias) => alias.includes(token))) return 1;
  return 0;
}

function passesFilters(entry: CatalogueEntry, options: SearchOptions): boolean {
  if (options.equipment !== undefined && options.equipment.length > 0) {
    if (!options.equipment.includes(entry.equipment)) return false;
  }
  if (options.muscle !== undefined) {
    if (!entry.muscles.some((share) => share.muscle === options.muscle && share.fraction > 0)) {
      return false;
    }
  }
  return true;
}

function rankMap(ids: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const [index, id] of ids.entries()) if (!map.has(id)) map.set(id, index);
  return map;
}
