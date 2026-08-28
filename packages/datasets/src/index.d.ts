/**
 * Public types for @freeforever/datasets.
 *
 * This is the contract the nutrition team codes against. It is hand-written
 * rather than emitted, so treat a change here as a change to a published API:
 * anything that breaks a consumer needs a SCHEMA_VERSION bump alongside it.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/** Per 100 g, or per 100 ml when `Food.basis` is `'ml'`. */
export interface Nutrients {
  /** kcal. Integer. */
  kcal: number;
  /** grams, to 0.01 */
  proteinG: number;
  carbG: number;
  fatG: number;
  fibreG: number;
  sugarG: number;
  /** milligrams. Integer. NOT grams — Open Food Facts states sodium in grams and the pipeline converts. */
  sodiumMg: number;
  /** grams, to 0.5 */
  satFatG: number;
}

export interface FoodFlags {
  /** `servingGrams` was inferred from a volume, not stated upstream. Show it as approximate. */
  servingEstimated: boolean;
  /** Stated energy disagrees with the macros by more than 25%. Consider showing a caveat. */
  atwaterMismatch: boolean;
  /** Upstream record was complete enough to trust without qualification. */
  highConfidence: boolean;
  hasBarcode: boolean;
  /**
   * Upstream stated an energy value, even if that value was zero. A food with
   * all-zero nutrients and `energyReported: true` is a diet soda; one with
   * `false` should never have shipped.
   */
  energyReported: boolean;
  /**
   * Energy was computed from the macros because upstream did not state it.
   * Accurate to within a few percent, but an estimate — worth marking in the UI
   * the same way `servingEstimated` is.
   */
  energyDerived: boolean;
}

export interface Food {
  /** Stable within a shard and index version: `${shard}:${sourceId}`. */
  id: string;
  name: string;
  brand: string | null;
  /** Upstream identifier: the FDC id, or the Open Food Facts barcode. */
  sourceId: string;
  /** GTIN exactly as scanned, leading zeros intact. Null when the food has none. */
  barcode: string | null;
  /** `usda-foundation` | `usda-sr-legacy` | `usda-branded` | `off` */
  source: string;
  /** `core` | `off` */
  shard: string;
  /** Licence governing THIS record's data: `public-domain-usgov` or `ODbL-1.0`. */
  licence: string;
  /**
   * The link that discharges upstream attribution. For Open Food Facts records
   * this is REQUIRED to be rendered somewhere reachable from the food's detail
   * view — it is a licence obligation, not a nicety. See NOTICE.md §2.2.
   */
  attributionUrl: string | null;
  basis: 'g' | 'ml';
  per100: Nutrients;
  /** Grams in one stated serving, or null. */
  servingGrams: number | null;
  /** Household measure for that serving, e.g. "1 cup". */
  servingLabel: string | null;
  flags: FoodFlags;
}

export interface SearchHit {
  food: Food;
  score: number;
}

export interface FoodIndexBuffers {
  /** Decompressed `food-<shard>-records-*.bin` body. */
  records: Uint8Array;
  /** Decompressed `food-<shard>-search-*.bin` body. Without it, `search()` returns nothing. */
  search?: Uint8Array;
  /** Decompressed `food-<shard>-barcodes-*.bin` body. Without it, `byBarcode()` returns null. */
  barcodes?: Uint8Array;
}

export declare class FoodIndex {
  constructor(buffers: FoodIndexBuffers);
  /** 0 | 1 */
  readonly shard: number;
  readonly shardName: string;
  readonly licence: string;
  /** Number of records. Valid ids are 0..length-1, in descending likelihood order. */
  readonly length: number;
  get(id: number): Food | null;
  /**
   * Prefix-aware, multi-token search. Tokens are ANDed; the final token is
   * treated as a prefix, so this is safe to call on every keystroke.
   */
  search(query: string, opts?: { limit?: number }): SearchHit[];
  byBarcode(barcode: string | number): Food | null;
}

/**
 * Queries the core and OFF shards as one list. Use this rather than a bare
 * FoodIndex: the shards are separate artefacts for licence reasons and the user
 * should never have to know that.
 */
export declare class FoodIndexSet {
  constructor(indexes: FoodIndex[]);
  readonly indexes: FoodIndex[];
  search(query: string, opts?: { limit?: number }): SearchHit[];
  byBarcode(barcode: string | number): Food | null;
  getById(id: string): Food | null;
}

export declare function openIndexFromUrls(
  urls: { records: string; search?: string; barcodes?: string },
  opts?: { fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<FoodIndex>;

export declare function gunzip(buf: Uint8Array): Promise<Uint8Array>;

export declare function attributionUrl(source: string, sourceId: string): string | null;

/** Folded, searchable form of a string. The pipeline and the query path share it. */
export declare function fold(s: string): string;
export declare function tokenise(s: string): string[];

export declare const SCHEMA_VERSION: number;
export declare const SHARD: { readonly CORE: 0; readonly OFF: 1 };
export declare const SHARD_NAME: Record<number, string>;
export declare const SHARD_LICENCE: Record<number, string>;
export declare const SOURCE: {
  readonly USDA_FOUNDATION: 0;
  readonly USDA_SR_LEGACY: 1;
  readonly USDA_BRANDED: 2;
  readonly OFF: 3;
};
export declare const SOURCE_NAME: Record<number, string>;

export declare const MEDIA_VERSION: string;
export declare const MEDIA_BUDGET: {
  maxBytesPerAsset: number;
  widthPx: number;
  quality: number;
  fallbackQuality: number;
  frameDurationMs: number;
  maxFrames: number;
  maxTotalBytes: number;
};
export declare function jsdelivrUrl(exerciseId: string, format?: 'webp' | 'avif'): string;
export declare function rawGithubUrl(exerciseId: string, format?: 'webp' | 'avif'): string;

// ── Exercise catalogue ─────────────────────────────────────────────────────
// Shipped as gzipped JSON (`exercises.json.gz`), not a binary artefact: 873
// records make a linear scan cheaper than an index.

export interface Exercise {
  id: string;
  name: string;
  /** Gym shorthand and synonyms: "ohp", "rdl", "bb squat". */
  aliases: string[];
  mechanic: 'compound' | 'isolation' | null;
  force: 'push' | 'pull' | 'static' | null;
  level: 'beginner' | 'intermediate' | 'expert' | null;
  category: string;
  equipment: string;
  /**
   * Specific muscles, deltoids split into `front-delts` / `side-delts` /
   * `rear-delts`. A plain `shoulders` here means the head could not be
   * determined — see `deltoidBasis`. Use `ExerciseCatalogue.muscleGroups` to
   * roll heads back up to a group.
   */
  primaryMuscles: string[];
  /** Never overlaps `primaryMuscles`. */
  secondaryMuscles: string[];
  /**
   * How the deltoid split was determined, or null when the exercise has no
   * deltoid involvement.
   *   `name`        — the movement name was conclusive (a lateral raise)
   *   `movement`    — inferred from the movement class for a secondary muscle
   *                   (a bench press works the front delts)
   *   `unspecified` — neither was conclusive, so the generic `shoulders` was
   *                   kept. An honest "don't know", not a default.
   */
  deltoidBasis: 'name' | 'movement' | 'unspecified' | null;
  /**
   * How a set is counted. Not in free-exercise-db; derived from the movement
   * name and category, because "Plank" and "Push Up" are both `strength` and
   * one is held while the other is counted.
   *
   * There is no `loadKind` companion: load follows from `equipment` with no
   * analysis ("body only" is bodyweight, "bands" is elastic, everything else is
   * external), and a second field carrying the same fact is one that can
   * disagree with the first.
   */
  effortUnit: 'reps' | 'time' | 'distance';
  instructions: string[];
  formCues: string[];
  commonMistakes: string[];
  /**
   * False when `formCues` and `commonMistakes` were produced by the rule engine
   * rather than written by a person. Render generated coaching with less
   * authority than authored coaching.
   */
  coachingAuthored: boolean;
  media: { id: string; formats: string[]; status: 'pending' | 'published' };
  source: { repo: string; id: string; licence: string };
  /** Upstream frame URLs. Inputs to the media pipeline; not for direct display. */
  upstreamImages: string[];
}

export interface ExerciseCatalogue {
  schemaVersion: number;
  builtAt: string;
  count: number;
  muscles: string[];
  equipment: string[];
  source: { repo: string; url: string; licence: string; licenceUrl: string; imageBase: string };
  coaching: {
    generator: string;
    authored: boolean;
    patternCoverage: Record<string, number>;
    exercisesWithNoPatternMatch: number;
  };
  exercises: Exercise[];
}
