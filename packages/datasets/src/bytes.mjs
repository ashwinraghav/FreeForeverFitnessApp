/**
 * Byte-level primitives shared by the encoder (Node) and the reader (browser).
 * No Node built-ins: this runs in a service worker.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/** Growable little-endian byte writer. */
export class ByteWriter {
  /** @param {number} [initial] */
  constructor(initial = 1024) {
    this.buf = new Uint8Array(initial);
    this.len = 0;
  }

  /** @param {number} n */
  #ensure(n) {
    if (this.len + n <= this.buf.length) return;
    // Math.max(1, ...) is load-bearing: a writer constructed with a zero
    // initial capacity (an empty shard) would otherwise double 0 forever.
    let cap = Math.max(1, this.buf.length * 2);
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  /** @param {number} v */
  u8(v) {
    this.#ensure(1);
    this.buf[this.len++] = v & 0xff;
    return this;
  }

  /** @param {number} v */
  u16(v) {
    this.#ensure(2);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
    return this;
  }

  /** @param {number} v */
  u32(v) {
    this.#ensure(4);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
    this.buf[this.len++] = (v >>> 16) & 0xff;
    this.buf[this.len++] = (v >>> 24) & 0xff;
    return this;
  }

  /**
   * LEB128 unsigned varint. Handles values up to Number.MAX_SAFE_INTEGER, which
   * matters because GTIN-13 values reach ~1e13 and are stored as plain numbers.
   * @param {number} v
   */
  varint(v) {
    if (!Number.isInteger(v) || v < 0 || v > Number.MAX_SAFE_INTEGER) {
      throw new RangeError(`varint out of range: ${v}`);
    }
    let n = v;
    while (n >= 0x80) {
      this.u8((n & 0x7f) | 0x80);
      n = Math.floor(n / 128);
    }
    return this.u8(n);
  }

  /** @param {Uint8Array} b */
  bytes(b) {
    this.#ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
    return this;
  }

  /** Length-prefixed UTF-8. @param {string} s */
  str(s) {
    const b = UTF8_ENCODER.encode(s);
    this.varint(b.length);
    return this.bytes(b);
  }

  /** Pad to a 4-byte boundary so typed-array views over sections stay aligned. */
  align4() {
    while (this.len % 4 !== 0) this.u8(0);
    return this;
  }

  finish() {
    return this.buf.subarray(0, this.len);
  }
}

/** Little-endian byte reader over a Uint8Array. */
export class ByteReader {
  /** @param {Uint8Array} buf @param {number} [pos] */
  constructor(buf, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }

  u8() {
    return this.buf[this.pos++] ?? 0;
  }

  u16() {
    const v = (this.buf[this.pos] ?? 0) | ((this.buf[this.pos + 1] ?? 0) << 8);
    this.pos += 2;
    return v;
  }

  u32() {
    const b = this.buf;
    const p = this.pos;
    this.pos += 4;
    return (
      ((b[p] ?? 0) | ((b[p + 1] ?? 0) << 8) | ((b[p + 2] ?? 0) << 16) | ((b[p + 3] ?? 0) << 24)) >>> 0
    );
  }

  varint() {
    let result = 0;
    let shift = 1;
    for (;;) {
      const byte = this.buf[this.pos++] ?? 0;
      result += (byte & 0x7f) * shift;
      if ((byte & 0x80) === 0) return result;
      shift *= 128;
    }
  }

  /** @param {number} n */
  take(n) {
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  str() {
    return UTF8_DECODER.decode(this.take(this.varint()));
  }

  get done() {
    return this.pos >= this.buf.length;
  }
}

export const UTF8_ENCODER = /* @__PURE__ */ new TextEncoder();
export const UTF8_DECODER = /* @__PURE__ */ new TextDecoder();

/**
 * Compare two byte strings lexicographically.
 *
 * The term dictionary is ordered by UTF-8 byte value — not `localeCompare`, not
 * UTF-16 code unit — so that the encoder's ordering and every reader's ordering
 * agree regardless of the device locale. Front-coding also operates on bytes, so
 * a shared prefix can never be cut inside a multi-byte code point.
 *
 * @param {Uint8Array} a @param {Uint8Array} b
 */
export function compareBytes(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/** @param {Uint8Array} a @param {Uint8Array} b */
export function sharedPrefixLen(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/** True if `b` starts with `prefix`. @param {Uint8Array} b @param {Uint8Array} prefix */
export function startsWithBytes(b, prefix) {
  if (prefix.length > b.length) return false;
  for (let i = 0; i < prefix.length; i++) if (b[i] !== prefix[i]) return false;
  return true;
}
