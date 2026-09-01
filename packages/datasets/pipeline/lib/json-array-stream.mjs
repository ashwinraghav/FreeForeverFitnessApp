/**
 * Stream the elements of one top-level array out of a large JSON file.
 *
 * USDA publishes its bulk exports as a single object wrapping one enormous
 * array — `{"BrandedFoods": [ … 1.4 million objects … ]}`, 3.3 GB for the
 * branded release. `JSON.parse` on that needs the whole document plus the whole
 * object graph resident, which is several times Node's default heap. A
 * streaming parser is the only way to read it, and pulling in a dependency for
 * one is not an option: this package has zero dependencies on purpose, so that
 * the pipeline runs in CI before anything is installed (README).
 *
 * This is not a general JSON parser. It scans for element boundaries — tracking
 * string state, escapes, and nesting depth — and hands each complete element to
 * `JSON.parse` individually. That is enough for "an array of objects" and
 * deliberately no more.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { createReadStream } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

/**
 * @param {string} path
 * @param {{maxElements?:number, highWaterMark?:number}} [opts]
 * @returns {AsyncGenerator<any>}
 */
export async function* streamJsonArray(path, { maxElements = Infinity, highWaterMark = 1 << 22 } = {}) {
  const stream = createReadStream(path, { highWaterMark });
  const decoder = new StringDecoder('utf8');

  let buf = '';
  /** Have we consumed the `[` that opens the array? */
  let started = false;
  /** Brace/bracket depth inside the current element. */
  let depth = 0;
  /** Index in `buf` where the current element began, or -1 between elements. */
  let elemStart = -1;
  let inString = false;
  let escaped = false;
  /** Scan position; everything before it has been classified. */
  let i = 0;
  let emitted = 0;

  for await (const chunk of stream) {
    buf += decoder.write(/** @type {Buffer} */ (chunk));

    for (; i < buf.length; i++) {
      const c = buf[i];

      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }

      if (!started) {
        // Skip the wrapper: `{"BrandedFoods":` up to the opening bracket. A
        // quoted key can contain a `[`, so string state is tracked here too.
        if (c === '"') inString = true;
        else if (c === '[') started = true;
        continue;
      }

      if (c === '"') {
        inString = true;
        if (depth === 0 && elemStart < 0) elemStart = i;
        continue;
      }
      if (c === '{' || c === '[') {
        if (depth === 0 && elemStart < 0) elemStart = i;
        depth++;
        continue;
      }
      if (c === '}' || c === ']') {
        if (depth === 0) {
          // The `]` that closes the outer array.
          if (elemStart >= 0) yield JSON.parse(buf.slice(elemStart, i).trim());
          return;
        }
        depth--;
        if (depth === 0 && elemStart >= 0) {
          yield JSON.parse(buf.slice(elemStart, i + 1));
          elemStart = -1;
          if (++emitted >= maxElements) return;
          // Everything up to here is consumed; drop it so the buffer stays
          // bounded rather than growing to the size of the file.
          buf = buf.slice(i + 1);
          i = -1;
        }
        continue;
      }
      // A scalar element (number, true, null) at depth 0 — not what USDA
      // produces, but cheap to handle rather than mis-parse.
      if (depth === 0 && elemStart < 0 && !/[\s,]/.test(/** @type {string} */ (c))) elemStart = i;
      if (depth === 0 && elemStart >= 0 && c === ',') {
        yield JSON.parse(buf.slice(elemStart, i).trim());
        elemStart = -1;
        if (++emitted >= maxElements) return;
        buf = buf.slice(i + 1);
        i = -1;
      }
    }

    // Nothing left to re-scan when we are between elements.
    if (elemStart < 0 && !inString) {
      buf = '';
      i = 0;
    }
  }
}
