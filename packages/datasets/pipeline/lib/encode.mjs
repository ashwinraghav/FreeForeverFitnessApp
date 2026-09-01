/**
 * Encoders for the three on-device artefacts.
 *
 * Record order IS rank order (see rank.mjs), which the encoders rely on twice:
 * the reader tie-breaks on "lower id wins" without a stored score, and doc-id
 * deltas in the postings lists stay small for the terms people actually search.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { ByteWriter, UTF8_ENCODER, compareBytes, sharedPrefixLen } from '../../src/bytes.mjs';
import { writeContainer } from '../../src/container.mjs';
import {
  BARCODE_SKIP_INTERVAL,
  FIELD,
  FIELD_BITS,
  FLAG,
  NUTRIENT_COLUMNS,
  SECTION,
  TERM_BLOCK_SIZE,
} from '../../src/schema.mjs';
import { tokenise } from '../../src/text.mjs';

/**
 * Encode the record store.
 * @param {import('./record.mjs').CanonicalRecord[]} records  in rank order
 * @param {number} shard
 */
export function encodeRecords(records, shard) {
  const names = new ByteWriter(records.length * 32);
  const sourceIds = new ByteWriter(records.length * 12);
  const flags = new Uint8Array(records.length);
  // Source lives in its own column rather than in spare flag bits: it is
  // near-constant down long runs of the rank order, so gzip reduces it to
  // almost nothing, and it leaves every flag bit available for real flags.
  const sourceCodes = new Uint8Array(records.length);
  const brandRefs = new ByteWriter(records.length * 2);
  const serving = new ByteWriter(records.length * 3);

  const brands = new StringDict();
  const servingLabels = new StringDict();

  // Columnar, not row-major: gzip's window sees 80,000 similar small integers in
  // a row instead of a repeating 16-byte struct. On the sample this is worth
  // ~35% of the nutrient section.
  const columns = NUTRIENT_COLUMNS.map((c) => new Uint8Array(c.width * records.length));

  records.forEach((r, i) => {
    names.str(r.name);
    sourceIds.str(r.sourceId);
    brandRefs.varint(r.brand ? brands.intern(r.brand) + 1 : 0);

    // Grams in tenths, +1 so that 0 can mean "no serving stated".
    serving.varint(r.servingGrams == null ? 0 : Math.round(r.servingGrams * 10) + 1);
    serving.varint(r.servingLabel ? servingLabels.intern(r.servingLabel) + 1 : 0);

    let f = 0;
    if (r.basis === 'ml') f |= FLAG.BASIS_ML;
    if (r.gtin != null) f |= FLAG.HAS_BARCODE;
    if (r.servingEstimated) f |= FLAG.SERVING_ESTIMATED;
    if (r.atwaterMismatch) f |= FLAG.ATWATER_MISMATCH;
    if (r.highConfidence) f |= FLAG.HIGH_CONFIDENCE;
    if (r.energyReported) f |= FLAG.ENERGY_REPORTED;
    if (r.energyDerived) f |= FLAG.ENERGY_DERIVED;
    flags[i] = f;
    sourceCodes[i] = r.source & 0xff;

    NUTRIENT_COLUMNS.forEach((col, c) => {
      const raw = Math.round(
        (r.n[/** @type {keyof typeof r.n} */ (col.key)] ?? 0) * col.scale,
      );
      const v = Math.max(0, Math.min(col.width === 1 ? 0xff : 0xffff, raw));
      const buf = /** @type {Uint8Array} */ (columns[c]);
      if (col.width === 1) {
        buf[i] = v;
      } else {
        buf[i * 2] = v & 0xff;
        buf[i * 2 + 1] = (v >>> 8) & 0xff;
      }
    });
  });

  const nutrients = new ByteWriter(columns.reduce((n, c) => n + c.length, 0));
  for (const c of columns) nutrients.bytes(c);

  return writeContainer({
    shard,
    recordCount: records.length,
    sections: new Map([
      [SECTION.NAME, names.finish()],
      [SECTION.BRAND_DICT, brands.encode()],
      [SECTION.BRAND_REF, brandRefs.finish()],
      [SECTION.NUTRIENTS, nutrients.finish()],
      [SECTION.SERVING, serving.finish()],
      [SECTION.SERVING_LABELS, servingLabels.encode()],
      [SECTION.SOURCE_IDS, sourceIds.finish()],
      [SECTION.FLAGS, flags],
      [SECTION.SOURCE_CODES, sourceCodes],
    ]),
  });
}

/**
 * Build the term -> postings map for a record set.
 * Exported so the size report can compare it against a trigram index without
 * duplicating the tokenisation rules.
 * @param {import('./record.mjs').CanonicalRecord[]} records
 * @returns {Map<string, Array<{doc:number, field:number}>>}
 */
export function buildPostings(records) {
  /** @type {Map<string, Array<{doc:number, field:number}>>} */
  const postings = new Map();
  /** @param {string} term @param {number} doc @param {number} field */
  const add = (term, doc, field) => {
    let list = postings.get(term);
    if (!list) postings.set(term, (list = []));
    const last = list[list.length - 1];
    if (last && last.doc === doc && last.field <= field) return; // keep the strongest field only
    list.push({ doc, field });
  };

  records.forEach((r, doc) => {
    for (const t of tokenise(r.name)) add(t, doc, FIELD.NAME);
    if (r.brand) for (const t of tokenise(r.brand)) add(t, doc, FIELD.BRAND);
    for (const alias of r.aliases) for (const t of tokenise(alias)) add(t, doc, FIELD.ALIAS);
  });
  return postings;
}

/**
 * Encode the search index: a front-coded, prefix-searchable term dictionary
 * over delta-varint postings. Rationale and the measured alternatives are in
 * docs/search-index-design.md.
 * @param {import('./record.mjs').CanonicalRecord[]} records
 * @param {number} shard
 */
export function encodeSearch(records, shard) {
  const postings = buildPostings(records);

  // Sort by UTF-8 byte order — the same order the reader binary-searches in.
  const terms = [...postings.keys()]
    .map((t) => ({ t, b: UTF8_ENCODER.encode(t) }))
    .sort((a, b) => compareBytes(a.b, b.b));

  const blocks = new ByteWriter(terms.length * 8);
  const blockIndex = new ByteWriter(1024);
  const plist = new ByteWriter(terms.length * 6);

  const blockCount = Math.ceil(terms.length / TERM_BLOCK_SIZE);
  blockIndex.varint(terms.length);
  blockIndex.varint(blockCount);

  /** @type {Array<{blockOff:number, postOff:number, first:Uint8Array}>} */
  const blockMeta = [];

  for (let b = 0; b < blockCount; b++) {
    const start = b * TERM_BLOCK_SIZE;
    const end = Math.min(terms.length, start + TERM_BLOCK_SIZE);
    const blockOff = blocks.len;
    const postOff = plist.len;

    for (let i = start; i < end; i++) {
      const cur = /** @type {{t:string, b:Uint8Array}} */ (terms[i]);
      if (i === start) {
        // Block heads are stored whole so a block is decodable standalone.
        blocks.varint(cur.b.length).bytes(cur.b);
      } else {
        const prev = /** @type {{t:string, b:Uint8Array}} */ (terms[i - 1]);
        const shared = sharedPrefixLen(prev.b, cur.b);
        blocks.varint(shared).varint(cur.b.length - shared).bytes(cur.b.subarray(shared));
      }

      const list = /** @type {Array<{doc:number, field:number}>} */ (postings.get(cur.t));
      list.sort((x, y) => x.doc - y.doc || x.field - y.field);
      const before = plist.len;
      plist.varint(list.length);
      let prevDoc = 0;
      for (const { doc, field } of list) {
        plist.varint(((doc - prevDoc) << FIELD_BITS) | field);
        prevDoc = doc;
      }
      // Byte length of this term's postings, so the reader can skip past terms
      // it did not match without decoding them.
      blocks.varint(plist.len - before);
    }

    blockMeta.push({
      blockOff,
      postOff,
      first: /** @type {{b:Uint8Array}} */ (terms[start]).b,
    });
  }

  for (const m of blockMeta) {
    blockIndex.varint(m.blockOff);
    blockIndex.varint(m.postOff);
    blockIndex.varint(m.first.length);
    blockIndex.bytes(m.first);
  }

  return writeContainer({
    shard,
    recordCount: records.length,
    sections: new Map([
      [SECTION.TERM_INDEX, blockIndex.finish()],
      [SECTION.TERM_BLOCKS, blocks.finish()],
      [SECTION.POSTINGS, plist.finish()],
    ]),
  });
}

/**
 * Encode the barcode table: GTINs sorted ascending, delta-varint encoded, with
 * a sparse checkpoint table so a scan lookup is a binary search over ~1/128th
 * of the entries followed by a short linear walk.
 *
 * A hash map would be O(1) but would cost ~8 bytes per entry uncompressed and
 * would not compress, because hashed keys are incompressible by construction.
 * Sorted deltas cost ~2 bytes per entry and gzip further. For a lookup that
 * happens once per barcode scan, not once per keystroke, that is the right
 * trade.
 *
 * @param {import('./record.mjs').CanonicalRecord[]} records
 * @param {number} shard
 */
export function encodeBarcodes(records, shard) {
  /** @type {Array<{gtin:number, doc:number, digits:number}>} */
  const entries = [];
  records.forEach((r, doc) => {
    // The digit count is stored because leading zeros are lost in the integer
    // and a GTIN-12 is not a GTIN-13 with a zero in front as far as a scanner,
    // a receipt, or Open Food Facts' URL scheme is concerned.
    if (r.gtin != null) entries.push({ gtin: r.gtin, doc, digits: r.gtinDigits ?? String(r.gtin).length });
    // Barcodes of duplicate rows folded into this one by dedupe. Scanning any
    // of a product's regional SKUs must reach the row we kept — see the
    // attribution note in lib/dedupe.mjs `absorb`.
    for (const g of r.extraGtins ?? []) entries.push({ gtin: g.value, doc, digits: g.digits });
  });
  entries.sort((a, b) => a.gtin - b.gtin);

  const body = new ByteWriter(entries.length * 4);
  const skip = new ByteWriter(256);
  /** @type {Array<{gtin:number, off:number, idx:number}>} */
  const checkpoints = [];

  body.varint(entries.length);
  let prev = 0;
  entries.forEach((e, i) => {
    if (i % BARCODE_SKIP_INTERVAL === 0) checkpoints.push({ gtin: e.gtin, off: body.len, idx: i });
    body.varint(e.gtin - prev);
    body.varint(e.doc);
    body.varint(e.digits);
    prev = e.gtin;
  });

  skip.varint(checkpoints.length);
  for (const c of checkpoints) skip.varint(c.gtin).varint(c.off).varint(c.idx);

  return writeContainer({
    shard,
    recordCount: entries.length,
    sections: new Map([
      [SECTION.BARCODES, body.finish()],
      [SECTION.BARCODE_SKIP, skip.finish()],
    ]),
  });
}

/** Interning dictionary for repeated strings (brands, serving labels). */
class StringDict {
  constructor() {
    /** @type {Map<string, number>} */
    this.ids = new Map();
    /** @type {string[]} */
    this.values = [];
  }

  /** @param {string} s */
  intern(s) {
    const existing = this.ids.get(s);
    if (existing !== undefined) return existing;
    const id = this.values.length;
    this.ids.set(s, id);
    this.values.push(s);
    return id;
  }

  encode() {
    const w = new ByteWriter(this.values.length * 12 + 8);
    w.varint(this.values.length);
    for (const v of this.values) w.str(v);
    return w.finish();
  }
}
