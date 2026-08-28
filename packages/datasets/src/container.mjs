/**
 * The section container. Shared by the encoder and the reader so the layout is
 * defined in exactly one place.
 *
 * Layout:
 *   u32  magic 'FFFI'
 *   u8   schemaVersion   — reader refuses a mismatch
 *   u8   formatMinor     — reader tolerates a higher value by skipping unknown sections
 *   u8   shardId
 *   u8   reserved
 *   u32  recordCount
 *   u32  sectionCount
 *   [sectionCount x] { u8 kind, u8[3] pad, u32 offset, u32 length }
 *   ...sections, each padded to a 4-byte boundary
 *
 * Unknown section kinds are skipped rather than rejected. That is what makes
 * FORMAT_MINOR additive: a client one release behind still opens the artefact
 * and simply lacks the new section.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { ByteWriter } from './bytes.mjs';
import { FORMAT_MINOR, HEADER_BYTES, MAGIC, SCHEMA_VERSION, SECTION_ENTRY_BYTES } from './schema.mjs';

/**
 * @param {{shard:number, recordCount:number, sections:Map<number, Uint8Array>}} spec
 * @returns {Uint8Array}
 */
export function writeContainer({ shard, recordCount, sections }) {
  const kinds = [...sections.keys()].sort((a, b) => a - b);
  const tableBytes = HEADER_BYTES + kinds.length * SECTION_ENTRY_BYTES;

  // Offsets must be known before the table is written, so lay the body out first.
  let offset = align4(tableBytes);
  /** @type {Array<{kind:number, offset:number, length:number}>} */
  const entries = [];
  for (const kind of kinds) {
    const body = /** @type {Uint8Array} */ (sections.get(kind));
    entries.push({ kind, offset, length: body.length });
    offset = align4(offset + body.length);
  }

  const w = new ByteWriter(offset);
  w.u32(MAGIC).u8(SCHEMA_VERSION).u8(FORMAT_MINOR).u8(shard).u8(0);
  w.u32(recordCount).u32(kinds.length);
  for (const e of entries) {
    w.u8(e.kind).u8(0).u8(0).u8(0).u32(e.offset).u32(e.length);
  }
  for (const e of entries) {
    while (w.len < e.offset) w.u8(0);
    w.bytes(/** @type {Uint8Array} */ (sections.get(e.kind)));
  }
  return w.finish();
}

/**
 * @param {Uint8Array} buf
 * @returns {{shard:number, recordCount:number, formatMinor:number, sections:Map<number, Uint8Array>}}
 */
export function readContainer(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a FreeForever index artefact');
  const schemaVersion = dv.getUint8(4);
  if (schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `index schemaVersion ${schemaVersion} but this reader speaks ${SCHEMA_VERSION}. ` +
        'Fetch a matching index rather than reading it partially.',
    );
  }
  const formatMinor = dv.getUint8(5);
  const shard = dv.getUint8(6);
  const recordCount = dv.getUint32(8, true);
  const sectionCount = dv.getUint32(12, true);

  /** @type {Map<number, Uint8Array>} */
  const sections = new Map();
  for (let i = 0; i < sectionCount; i++) {
    const p = HEADER_BYTES + i * SECTION_ENTRY_BYTES;
    const kind = dv.getUint8(p);
    const off = dv.getUint32(p + 4, true);
    const len = dv.getUint32(p + 8, true);
    if (off + len > buf.length) throw new Error(`section ${kind} runs past the end of the buffer`);
    sections.set(kind, buf.subarray(off, off + len));
  }
  return { shard, recordCount, formatMinor, sections };
}

/** @param {number} n */
function align4(n) {
  return (n + 3) & ~3;
}
