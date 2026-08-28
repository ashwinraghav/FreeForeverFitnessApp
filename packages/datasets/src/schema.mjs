/**
 * Shared schema constants for the on-device food index and exercise catalogue.
 *
 * This module is imported by BOTH the build pipeline (Node) and the app runtime
 * (browser). It must stay dependency-free and side-effect-free.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bump on any change that an already-installed client cannot read.
 * The runtime refuses to load an artefact whose `schemaVersion` differs.
 * Additive changes that old readers can skip use `formatMinor` instead.
 */
export const SCHEMA_VERSION = 1;
export const FORMAT_MINOR = 0;

/** Magic bytes at the head of every binary artefact. "FFFI" = FreeForever Food Index. */
export const MAGIC = 0x46464649; // 'F','F','F','I'

/** Shards are built, licensed and published independently. See NOTICE.md §2.4. */
export const SHARD = /** @type {const} */ ({
  /** USDA FoodData Central only. Public domain. */
  CORE: 0,
  /** Open Food Facts only. ODbL-1.0, attribution + share-alike. */
  OFF: 1,
});

/** @type {Record<number, string>} */
export const SHARD_NAME = { 0: 'core', 1: 'off' };

/** @type {Record<number, string>} */
export const SHARD_LICENCE = { 0: 'public-domain-usgov', 1: 'ODbL-1.0' };

export const SOURCE = /** @type {const} */ ({
  USDA_FOUNDATION: 0,
  USDA_SR_LEGACY: 1,
  USDA_BRANDED: 2,
  OFF: 3,
});

/** @type {Record<number, string>} */
export const SOURCE_NAME = {
  0: 'usda-foundation',
  1: 'usda-sr-legacy',
  2: 'usda-branded',
  3: 'off',
};

/** Which shard a source is allowed to land in. Enforced by verify-index.mjs. */
export const SOURCE_SHARD = { 0: SHARD.CORE, 1: SHARD.CORE, 2: SHARD.CORE, 3: SHARD.OFF };

/**
 * Section identifiers inside a binary artefact. A reader skips sections it does
 * not recognise, which is what makes FORMAT_MINOR bumps backward-compatible.
 */
export const SECTION = /** @type {const} */ ({
  NAME: 1, // length-prefixed UTF-8 display names, record order
  BRAND_DICT: 2, // brand string dictionary
  BRAND_REF: 3, // per-record varint brand id (0 = none)
  NUTRIENTS: 4, // columnar fixed-width nutrient arrays
  SERVING: 5, // per-record serving grams + label id
  SERVING_LABELS: 6, // serving label string dictionary
  SOURCE_IDS: 7, // per-record upstream id (FDC id / OFF barcode) — REQUIRED on the OFF shard
  TERM_BLOCKS: 8, // front-coded term dictionary
  TERM_INDEX: 9, // per-block skip index into TERM_BLOCKS + POSTINGS
  POSTINGS: 10, // delta-varint postings lists
  BARCODES: 11, // sorted delta-varint GTIN -> record id
  BARCODE_SKIP: 12, // sparse checkpoints into BARCODES
  FLAGS: 13, // one FLAG byte per record
  SOURCE_CODES: 14, // one SOURCE code per record
});

/** Bytes of container header before the section table. */
export const HEADER_BYTES = 16;
/** Bytes per section-table entry. */
export const SECTION_ENTRY_BYTES = 12;

/** Nutrient columns, in the order they are written. All are per 100 g / 100 ml. */
export const NUTRIENT_COLUMNS = /** @type {const} */ ([
  { key: 'kcal', width: 2, scale: 1 }, // kcal, integer
  { key: 'proteinG', width: 2, scale: 100 }, // centigrams
  { key: 'carbG', width: 2, scale: 100 },
  { key: 'fatG', width: 2, scale: 100 },
  { key: 'fibreG', width: 2, scale: 100 },
  { key: 'sugarG', width: 2, scale: 100 },
  { key: 'sodiumMg', width: 2, scale: 1 }, // mg, integer
  { key: 'satFatG', width: 1, scale: 2 }, // half-grams, max 127.5 g
]);

export const FLAG = /** @type {const} */ ({
  /** Nutrient basis is per 100 ml rather than per 100 g. */
  BASIS_ML: 1 << 0,
  /** Record has a GTIN in the barcode table. */
  HAS_BARCODE: 1 << 1,
  /** servingGrams was inferred (e.g. from a volume + assumed density), not stated upstream. */
  SERVING_ESTIMATED: 1 << 2,
  /** Stated kcal disagrees with the Atwater estimate by more than ATWATER_TOLERANCE. */
  ATWATER_MISMATCH: 1 << 3,
  /** Upstream record was complete enough to trust without qualification. */
  HIGH_CONFIDENCE: 1 << 4,
  /**
   * Upstream explicitly stated an energy value, even if that value was zero.
   *
   * This is the difference between "diet soda, 0 kcal" and "bread, energy field
   * missing", which are identical in the stored numbers and opposite in
   * meaning. Without it the pipeline either ships bread with no calories or
   * drops every zero-calorie drink, and both are wrong.
   */
  ENERGY_REPORTED: 1 << 5,
  /**
   * Energy was absent upstream and has been computed from the macros using the
   * Atwater factors. The value is good — for the records this fires on it lands
   * within a few percent of the published figure — but it is an estimate and
   * the app should be able to say so.
   */
  ENERGY_DERIVED: 1 << 6,
});

/** Postings entries pack a 2-bit field code into the low bits of the doc-id delta. */
export const FIELD = /** @type {const} */ ({ NAME: 0, BRAND: 1, ALIAS: 2 });
export const FIELD_BITS = 2;
export const FIELD_MASK = 0b11;

/** Terms are front-coded in blocks of this size. Trade-off documented in docs/search-index-design.md. */
export const TERM_BLOCK_SIZE = 16;

/** One checkpoint every N barcodes, for binary search over the delta-encoded list. */
export const BARCODE_SKIP_INTERVAL = 128;

/** Relative kcal error above which a record is flagged ATWATER_MISMATCH. */
export const ATWATER_TOLERANCE = 0.25;

/** Nutrient values outside these bounds mean the record is broken; it is dropped. */
export const SANITY = /** @type {const} */ ({
  maxKcalPer100g: 902, // pure fat is 900; anything above is a unit error
  maxMacroG: 100,
  maxSodiumMg: 40000, // salt itself is ~38,758 mg/100 g
});

/** Assumed density when a serving is stated in ml and no density is available. */
export const DEFAULT_DENSITY_G_PER_ML = 1.0;

/** Prefix expansion is capped so a one-letter query cannot walk the whole dictionary. */
export const MAX_PREFIX_TERMS = 64;

/** Minimum query token length that triggers prefix expansion rather than exact match. */
export const MIN_PREFIX_LEN = 2;
