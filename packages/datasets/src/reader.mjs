/**
 * On-device reader for the food index. This is the module the nutrition team
 * imports; nothing else in this package is part of the app's runtime surface.
 *
 * Design constraints it is written against:
 *  - No Node built-ins. Runs in a browser tab and in a service worker.
 *  - No eager decode. Opening an index parses the header and the block index
 *    only; names, source ids and postings are decoded on the records a query
 *    actually touches. Opening the full index is single-digit milliseconds.
 *  - No allocation per keystroke beyond the result array.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { ByteReader, UTF8_DECODER, UTF8_ENCODER, compareBytes, startsWithBytes } from './bytes.mjs';
import { readContainer } from './container.mjs';
import {
  FIELD,
  FIELD_BITS,
  FIELD_MASK,
  FLAG,
  MAX_PREFIX_TERMS,
  MIN_PREFIX_LEN,
  NUTRIENT_COLUMNS,
  SECTION,
  SHARD_LICENCE,
  SHARD_NAME,
  SOURCE_NAME,
  TERM_BLOCK_SIZE,
} from './schema.mjs';
import { tokenise } from './text.mjs';

/** Field weights when scoring a hit. A name match beats a brand match. */
const FIELD_WEIGHT = { [FIELD.NAME]: 1.0, [FIELD.BRAND]: 0.6, [FIELD.ALIAS]: 0.45 };

/**
 * @typedef {object} Food
 * @property {string}  id        stable within a shard+version: `${shard}:${sourceId}`
 * @property {string}  name
 * @property {string|null} brand
 * @property {string}  sourceId
 * @property {string|null} barcode  GTIN as scanned, leading zeros intact; null if none
 * @property {string}  source    e.g. "usda-foundation", "off"
 * @property {string}  shard     "core" | "off"
 * @property {string}  licence   licence governing THIS record's data
 * @property {string|null} attributionUrl  link that discharges upstream attribution, if any
 * @property {'g'|'ml'} basis
 * @property {import('../pipeline/lib/nutrients.mjs').Nutrients} per100
 * @property {number|null} servingGrams
 * @property {string|null} servingLabel
 * @property {{servingEstimated:boolean, atwaterMismatch:boolean, highConfidence:boolean, hasBarcode:boolean, energyReported:boolean, energyDerived:boolean}} flags
 */

/** @typedef {{food:Food, score:number}} SearchHit */

export class FoodIndex {
  /**
   * @param {{records:Uint8Array, search?:Uint8Array, barcodes?:Uint8Array}} buffers
   *        Already-decompressed artefact bodies. Use `gunzip` from your fetch
   *        layer, or `DecompressionStream('gzip')`.
   */
  constructor({ records, search, barcodes }) {
    const rc = readContainer(records);
    this.shard = rc.shard;
    this.shardName = SHARD_NAME[rc.shard] ?? 'unknown';
    this.licence = SHARD_LICENCE[rc.shard] ?? 'unknown';
    this.length = rc.recordCount;
    this.#sections = rc.sections;

    this.#search = search ? readContainer(search) : null;
    this.#barcodes = barcodes ? readContainer(barcodes) : null;
  }

  /** @type {Map<number, Uint8Array>} */
  #sections;
  /** @type {{sections:Map<number, Uint8Array>}|null} */
  #search;
  /** @type {{sections:Map<number, Uint8Array>}|null} */
  #barcodes;

  /** @type {Uint32Array|null} */ #nameOffsets = null;
  /** @type {Uint32Array|null} */ #sourceIdOffsets = null;
  /** @type {Uint32Array|null} */ #brandRefOffsets = null;
  /** @type {Uint32Array|null} */ #servingOffsets = null;
  /** @type {string[]|null} */ #brandDict = null;
  /** @type {string[]|null} */ #servingLabelDict = null;
  /** @type {Array<{blockOff:number, postOff:number, first:Uint8Array}>|null} */ #blocks = null;
  /** @type {Array<string|null>|null} */ #barcodeByDoc = null;

  /** @param {number} kind */
  #section(kind) {
    const s = this.#sections.get(kind);
    if (!s) throw new Error(`index is missing section ${kind}`);
    return s;
  }

  /**
   * Materialise one record.
   * @param {number} id
   * @returns {Food|null}
   */
  get(id) {
    if (!Number.isInteger(id) || id < 0 || id >= this.length) return null;

    const flags = this.#section(SECTION.FLAGS)[id] ?? 0;
    const sourceCode = this.#section(SECTION.SOURCE_CODES)[id] ?? 0;
    const sourceId = readStrAt(this.#section(SECTION.SOURCE_IDS), this.#offsets('sourceId')[id] ?? 0);

    const brandRef = readVarintAt(this.#section(SECTION.BRAND_REF), this.#offsets('brandRef')[id] ?? 0);
    const brand = brandRef === 0 ? null : (this.#brands()[brandRef - 1] ?? null);

    const sr = new ByteReader(this.#section(SECTION.SERVING), this.#offsets('serving')[id] ?? 0);
    const servingRaw = sr.varint();
    const labelRef = sr.varint();

    return {
      id: `${this.shardName}:${sourceId}`,
      name: readStrAt(this.#section(SECTION.NAME), this.#offsets('name')[id] ?? 0),
      brand,
      sourceId,
      barcode: flags & FLAG.HAS_BARCODE ? (this.#barcodes ? this.#barcodeMap()[id] ?? null : null) : null,
      source: SOURCE_NAME[sourceCode] ?? 'unknown',
      shard: this.shardName,
      licence: this.licence,
      attributionUrl: attributionUrl(SOURCE_NAME[sourceCode] ?? '', sourceId),
      basis: flags & FLAG.BASIS_ML ? 'ml' : 'g',
      per100: this.#nutrients(id),
      servingGrams: servingRaw === 0 ? null : (servingRaw - 1) / 10,
      servingLabel: labelRef === 0 ? null : (this.#servingLabels()[labelRef - 1] ?? null),
      flags: {
        servingEstimated: (flags & FLAG.SERVING_ESTIMATED) !== 0,
        atwaterMismatch: (flags & FLAG.ATWATER_MISMATCH) !== 0,
        highConfidence: (flags & FLAG.HIGH_CONFIDENCE) !== 0,
        hasBarcode: (flags & FLAG.HAS_BARCODE) !== 0,
        energyReported: (flags & FLAG.ENERGY_REPORTED) !== 0,
        energyDerived: (flags & FLAG.ENERGY_DERIVED) !== 0,
      },
    };
  }

  /**
   * Prefix-aware, multi-token search.
   *
   * Tokens are ANDed. The last token is treated as a prefix (the user is still
   * typing it); earlier tokens must match exactly, because "chick breast" should
   * not also match "chickpea breaststroke" once the user has moved on.
   *
   * @param {string} query
   * @param {{limit?:number}} [opts]
   * @returns {SearchHit[]}
   */
  search(query, { limit = 20 } = {}) {
    const tokens = tokenise(query);
    if (tokens.length === 0) return [];

    /** @type {Map<number, number>|null} */
    let acc = null;
    for (let i = 0; i < tokens.length; i++) {
      const token = /** @type {string} */ (tokens[i]);
      const isLast = i === tokens.length - 1;
      const scores = this.#scoreToken(token, isLast && token.length >= MIN_PREFIX_LEN);
      if (scores.size === 0) return [];
      if (acc === null) {
        acc = scores;
      } else {
        // Intersect. Iterating the smaller map keeps this cheap when one token
        // is highly selective, which is the common case ("greek" + "yog").
        const [small, large] = acc.size <= scores.size ? [acc, scores] : [scores, acc];
        /** @type {Map<number, number>} */
        const next = new Map();
        for (const [doc, s] of small) {
          const other = large.get(doc);
          if (other !== undefined) next.set(doc, s + other);
        }
        acc = next;
      }
      if (acc.size === 0) return [];
    }

    /** @type {SearchHit[]} */
    const hits = [];
    for (const [doc, s] of /** @type {Map<number, number>} */ (acc)) {
      // Rank order is record order, so a lower id is a more likely food. The
      // bonus decays smoothly rather than dominating a strong text match.
      hits.push({ doc, score: s + 0.5 / (1 + doc / 500) });
    }
    hits.sort((a, b) => b.score - a.score || a.doc - b.doc);

    /** @type {SearchHit[]} */
    const out = [];
    for (const h of hits.slice(0, limit)) {
      const food = this.get(h.doc);
      if (food) out.push({ food, score: h.score });
    }
    return out;
  }

  /**
   * Exact barcode lookup. Accepts a string because scanner output is a string
   * and leading zeros are significant to the scanner even though they are not
   * significant to the stored integer.
   * @param {string|number} barcode
   * @returns {Food|null}
   */
  byBarcode(barcode) {
    if (!this.#barcodes) return null;
    const digits = String(barcode).replace(/\D/g, '');
    if (!digits) return null;
    const target = Number(digits);
    if (!Number.isSafeInteger(target)) return null;

    const skipSec = this.#barcodes.sections.get(SECTION.BARCODE_SKIP);
    const bodySec = this.#barcodes.sections.get(SECTION.BARCODES);
    if (!skipSec || !bodySec) return null;

    const sr = new ByteReader(skipSec);
    const cpCount = sr.varint();
    let startOff = -1;
    let startGtin = 0;
    // Linear over checkpoints: at 128 entries per checkpoint a million barcodes
    // is ~8k checkpoints, and a binary search over them saves microseconds on an
    // interaction that happens once per scan. Kept simple on purpose.
    let bestOff = -1;
    let bestGtin = 0;
    for (let i = 0; i < cpCount; i++) {
      const gtin = sr.varint();
      const off = sr.varint();
      sr.varint(); // entry index, unused on this path
      if (gtin <= target) {
        bestOff = off;
        bestGtin = gtin;
      } else break;
    }
    if (bestOff < 0) return null;
    startOff = bestOff;
    startGtin = bestGtin;

    const br = new ByteReader(bodySec, startOff);
    let cur = startGtin;
    // The checkpoint stores the absolute GTIN of the entry AT that offset, and
    // the delta stored at that offset is relative to the PREVIOUS entry, so the
    // first delta read here reconstructs `cur` itself.
    let first = true;
    for (let i = 0; i < BARCODE_SCAN_LIMIT && br.pos < bodySec.length; i++) {
      const delta = br.varint();
      const doc = br.varint();
      br.varint(); // digit count, only needed by #barcodeMap
      cur = first ? startGtin : cur + delta;
      first = false;
      if (cur === target) return this.get(doc);
      if (cur > target) return null;
    }
    return null;
  }

  /** @param {string} token @param {boolean} asPrefix */
  #scoreToken(token, asPrefix) {
    /** @type {Map<number, number>} */
    const scores = new Map();
    if (!this.#search) return scores;
    const needle = UTF8_ENCODER.encode(token);

    let matched = 0;
    for (const { term, postOff } of this.#walkTerms(needle, asPrefix)) {
      if (++matched > MAX_PREFIX_TERMS) break;
      // An exact hit is worth more than a longer term the prefix expanded into:
      // "milk" should outrank "milkshake" for the query "milk".
      const lengthPenalty = term.length === needle.length ? 1 : needle.length / term.length;
      for (const { doc, field } of this.#postingsAt(postOff)) {
        const w = (FIELD_WEIGHT[field] ?? 0.3) * lengthPenalty;
        const prev = scores.get(doc);
        if (prev === undefined || w > prev) scores.set(doc, w);
      }
    }
    return scores;
  }

  /**
   * Walk the term dictionary from the first term >= needle, yielding matches.
   * @param {Uint8Array} needle @param {boolean} asPrefix
   */
  *#walkTerms(needle, asPrefix) {
    const blocks = this.#termBlocks();
    if (blocks.length === 0) return;

    // Binary search for the last block whose head is <= needle. The needle may
    // sit mid-block, so we must start at that block rather than the one after.
    let lo = 0;
    let hi = blocks.length - 1;
    let start = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (compareBytes(/** @type {any} */ (blocks[mid]).first, needle) <= 0) {
        start = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }

    const blockSec = /** @type {{sections:Map<number, Uint8Array>}} */ (this.#search).sections.get(
      SECTION.TERM_BLOCKS,
    );
    if (!blockSec) return;

    for (let b = start; b < blocks.length; b++) {
      const meta = /** @type {{blockOff:number, postOff:number}} */ (blocks[b]);
      const r = new ByteReader(blockSec, meta.blockOff);
      let post = meta.postOff;
      /** @type {Uint8Array} */
      let prev = new Uint8Array(0);

      for (let i = 0; i < TERM_BLOCK_SIZE; i++) {
        if (r.pos >= blockSec.length) return;
        /** @type {Uint8Array} */
        let term;
        if (i === 0) {
          term = r.take(r.varint());
        } else {
          const shared = r.varint();
          const suffix = r.take(r.varint());
          term = new Uint8Array(shared + suffix.length);
          term.set(prev.subarray(0, shared));
          term.set(suffix, shared);
        }
        const postLen = r.varint();
        prev = term;

        const cmp = compareBytes(term, needle);
        if (asPrefix) {
          if (startsWithBytes(term, needle)) yield { term, postOff: post };
          else if (cmp > 0) return; // past the prefix range
        } else {
          if (cmp === 0) {
            yield { term, postOff: post };
            return;
          }
          if (cmp > 0) return;
        }
        post += postLen;
      }
    }
  }

  /** @param {number} off */
  *#postingsAt(off) {
    const sec = /** @type {{sections:Map<number, Uint8Array>}} */ (this.#search).sections.get(
      SECTION.POSTINGS,
    );
    if (!sec) return;
    const r = new ByteReader(sec, off);
    const df = r.varint();
    let doc = 0;
    for (let i = 0; i < df; i++) {
      const packed = r.varint();
      doc += packed >>> FIELD_BITS;
      yield { doc, field: packed & FIELD_MASK };
    }
  }

  /**
   * doc id -> barcode string, built once on first use by scanning the barcode
   * table. Nothing is stored per record in the artefact for this: the mapping
   * already exists in the barcode table, and duplicating a 13-digit number on
   * every record would cost more on the wire than it saves at runtime.
   */
  #barcodeMap() {
    if (this.#barcodeByDoc) return this.#barcodeByDoc;
    /** @type {Array<string|null>} */
    const map = new Array(this.length).fill(null);
    const sec = this.#barcodes?.sections.get(SECTION.BARCODES);
    if (sec) {
      const r = new ByteReader(sec);
      const count = r.varint();
      let gtin = 0;
      for (let i = 0; i < count; i++) {
        gtin += r.varint();
        const doc = r.varint();
        const digits = r.varint();
        if (doc < map.length) map[doc] = String(gtin).padStart(digits, '0');
      }
    }
    return (this.#barcodeByDoc = map);
  }

  #termBlocks() {
    if (this.#blocks) return this.#blocks;
    /** @type {Array<{blockOff:number, postOff:number, first:Uint8Array}>} */
    const blocks = [];
    const sec = this.#search?.sections.get(SECTION.TERM_INDEX);
    if (sec) {
      const r = new ByteReader(sec);
      r.varint(); // total term count, informational
      const blockCount = r.varint();
      for (let i = 0; i < blockCount; i++) {
        const blockOff = r.varint();
        const postOff = r.varint();
        const first = r.take(r.varint());
        blocks.push({ blockOff, postOff, first });
      }
    }
    return (this.#blocks = blocks);
  }

  /** @param {number} id */
  #nutrients(id) {
    const sec = this.#section(SECTION.NUTRIENTS);
    /** @type {any} */
    const out = {};
    let base = 0;
    for (const col of NUTRIENT_COLUMNS) {
      const raw =
        col.width === 1
          ? (sec[base + id] ?? 0)
          : (sec[base + id * 2] ?? 0) | ((sec[base + id * 2 + 1] ?? 0) << 8);
      out[col.key] = col.scale === 1 ? raw : raw / col.scale;
      base += col.width * this.length;
    }
    return out;
  }

  #brands() {
    return (this.#brandDict ??= readStringDict(this.#section(SECTION.BRAND_DICT)));
  }

  #servingLabels() {
    return (this.#servingLabelDict ??= readStringDict(this.#section(SECTION.SERVING_LABELS)));
  }

  /**
   * Variable-length sections have no offset table in the artefact — storing one
   * would cost 4 bytes per record per section. Instead the reader scans once, on
   * first access, and caches. One scan of 80k varints is well under a frame.
   * @param {'name'|'sourceId'|'brandRef'|'serving'} which
   */
  #offsets(which) {
    switch (which) {
      case 'name':
        return (this.#nameOffsets ??= scanLengthPrefixed(this.#section(SECTION.NAME), this.length));
      case 'sourceId':
        return (this.#sourceIdOffsets ??= scanLengthPrefixed(
          this.#section(SECTION.SOURCE_IDS),
          this.length,
        ));
      case 'brandRef':
        return (this.#brandRefOffsets ??= scanVarints(this.#section(SECTION.BRAND_REF), this.length, 1));
      case 'serving':
        return (this.#servingOffsets ??= scanVarints(this.#section(SECTION.SERVING), this.length, 2));
    }
  }
}

/**
 * Query several shards as one list. The app always uses this rather than a bare
 * FoodIndex, because the core and OFF shards are separate artefacts for licence
 * reasons (NOTICE.md §2.4) and the user should never have to know that.
 *
 * The union exists only in memory, on the user's device. It is not a published
 * database and so triggers no ODbL obligation of its own.
 */
export class FoodIndexSet {
  /** @param {FoodIndex[]} indexes */
  constructor(indexes) {
    this.indexes = indexes;
  }

  /** @param {string} query @param {{limit?:number}} [opts] */
  search(query, { limit = 20 } = {}) {
    /** @type {SearchHit[]} */
    const all = [];
    for (const idx of this.indexes) all.push(...idx.search(query, { limit }));
    all.sort((a, b) => b.score - a.score);
    return all.slice(0, limit);
  }

  /** @param {string|number} barcode */
  byBarcode(barcode) {
    for (const idx of this.indexes) {
      const hit = idx.byBarcode(barcode);
      if (hit) return hit;
    }
    return null;
  }

  /** @param {string} id  `${shard}:${sourceId}` */
  getById(id) {
    const shard = id.slice(0, id.indexOf(':'));
    const idx = this.indexes.find((i) => i.shardName === shard);
    if (!idx) return null;
    // Linear over one shard; the app should hold onto the Food object from the
    // search result rather than round-tripping through an id.
    for (let i = 0; i < idx.length; i++) {
      const f = idx.get(i);
      if (f?.id === id) return f;
    }
    return null;
  }
}

/** Cap on the linear walk after a barcode checkpoint. See BARCODE_SKIP_INTERVAL. */
const BARCODE_SCAN_LIMIT = 256;

/**
 * The link that discharges upstream attribution for one record.
 * OFF requires a link to the product page (NOTICE.md §2.2); USDA requires
 * nothing, but a link to the source record is useful, so we emit one.
 * @param {string} source @param {string} sourceId
 */
export function attributionUrl(source, sourceId) {
  if (!sourceId) return null;
  if (source === 'off') return `https://world.openfoodfacts.org/product/${sourceId}`;
  if (source.startsWith('usda')) return `https://fdc.nal.usda.gov/food-details/${sourceId}/nutrients`;
  return null;
}

/** @param {Uint8Array} sec @param {number} off */
function readStrAt(sec, off) {
  const r = new ByteReader(sec, off);
  return UTF8_DECODER.decode(r.take(r.varint()));
}

/** @param {Uint8Array} sec @param {number} off */
function readVarintAt(sec, off) {
  return new ByteReader(sec, off).varint();
}

/** @param {Uint8Array} sec */
function readStringDict(sec) {
  const r = new ByteReader(sec);
  const n = r.varint();
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = r.str();
  return out;
}

/** @param {Uint8Array} sec @param {number} count */
function scanLengthPrefixed(sec, count) {
  const offsets = new Uint32Array(count);
  const r = new ByteReader(sec);
  for (let i = 0; i < count; i++) {
    offsets[i] = r.pos;
    r.take(r.varint());
  }
  return offsets;
}

/** @param {Uint8Array} sec @param {number} count @param {number} perRecord */
function scanVarints(sec, count, perRecord) {
  const offsets = new Uint32Array(count);
  const r = new ByteReader(sec);
  for (let i = 0; i < count; i++) {
    offsets[i] = r.pos;
    for (let k = 0; k < perRecord; k++) r.varint();
  }
  return offsets;
}
