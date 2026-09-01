/**
 * Finding and streaming the upstream corpora.
 *
 * The sample build reads two committed JSON arrays. A full build reads USDA's
 * bulk JSON exports (3.3 GB for Branded alone) and Open Food Facts' JSONL dump
 * (12.8 GB compressed). Both must go through the SAME adapters, or the sample
 * build stops being evidence about the real one — which is exactly how a
 * pipeline ends up proven on 784 records and never run for real.
 *
 * So this module normalises "what is in the input directory" into two async
 * iterables of upstream rows, and nothing downstream knows which it got.
 *
 * Layout it understands, in order of preference:
 *
 *   <input>/usda/FoodData_Central_*_food_json_*.json   bulk export, streamed
 *   <input>/usda-sample.json                           committed sample array
 *
 *   <input>/off/*.jsonl.gz                             the published dump
 *   <input>/off/*.ndjson[.gz]                          a projected local copy
 *   <input>/off-sample.json                            committed sample array
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createGunzip } from 'node:zlib';

import { streamJsonArray } from './json-array-stream.mjs';
import { project } from '../sources/off.mjs';

/**
 * The bulk exports do not always stamp `dataType` on every row, and `mapFood`
 * routes on it — a missing one silently drops the whole file. The filename
 * says which release it is, so we can supply it.
 */
const DATA_TYPE_BY_FILENAME = [
  [/branded/i, 'Branded'],
  [/foundation/i, 'Foundation'],
  [/sr_legacy/i, 'SR Legacy'],
  [/survey|fndds/i, 'Survey (FNDDS)'],
];

/**
 * @param {string} dir
 * @returns {Promise<{rows: AsyncIterable<any>, describe: string}>}
 */
export async function loadUsda(dir) {
  const files = await filesIn(resolve(dir, 'usda'), /\.json$/i);
  if (files.length > 0) {
    return {
      describe: files.map((f) => f.replace(/^.*\//, '')).join(', '),
      rows: (async function* () {
        for (const file of files) {
          const stamp = DATA_TYPE_BY_FILENAME.find(([re]) => re.test(file))?.[1];
          for await (const row of streamJsonArray(file)) {
            // USDA's bulk exports carry a run of literal `null` elements at the
            // end of the array. Not a parse failure — the file really says so.
            if (!row || typeof row !== 'object') continue;
            if (stamp && !row.dataType) row.dataType = stamp;
            yield row;
          }
        }
      })(),
    };
  }
  const sample = resolve(dir, 'usda-sample.json');
  return { describe: 'usda-sample.json', rows: await readArray(sample) };
}

/**
 * @param {string} dir
 * @returns {Promise<{rows: AsyncIterable<any>, describe: string}>}
 */
export async function loadOff(dir) {
  const files = await filesIn(resolve(dir, 'off'), /\.(jsonl|ndjson)(\.gz)?$/i);
  if (files.length > 0) {
    return {
      describe: files.map((f) => f.replace(/^.*\//, '')).join(', '),
      rows: (async function* () {
        for (const file of files) {
          for await (const row of streamNdjson(file)) yield project(row);
        }
      })(),
    };
  }
  const sample = resolve(dir, 'off-sample.json');
  return { describe: 'off-sample.json', rows: await readArray(sample) };
}

/**
 * Read NDJSON, optionally gzipped, one parsed object at a time.
 *
 * The decoder matters: a gzip chunk boundary lands wherever the compressor put
 * it, regularly mid-UTF-8-sequence, and decoding each chunk independently turns
 * every accented product name into mojibake.
 *
 * @param {string} path
 * @returns {AsyncGenerator<any>}
 */
export async function* streamNdjson(path) {
  /** @type {import('node:stream').Readable} */
  let stream = createReadStream(path, { highWaterMark: 1 << 22 });
  if (/\.gz$/i.test(path)) stream = stream.pipe(createGunzip());

  const decoder = new StringDecoder('utf8');
  let buf = '';
  try {
    for await (const chunk of stream) {
      buf += decoder.write(/** @type {Buffer} */ (chunk));
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          yield JSON.parse(line);
        } catch {
          // A dump line we cannot parse is one product, not a build failure.
        }
      }
    }
  } catch (err) {
    // A published dump can be a partial file: an interrupted download leaves a
    // valid gzip prefix with no trailer, and zlib reports Z_BUF_ERROR at the cut.
    // Every record before the cut is intact. We ship under 2% of this corpus
    // anyway, so ending early makes the pool smaller, not wrong — and failing
    // the whole build over a missing trailer would discard 1.5M good records.
    // Any other decode error is real and still throws.
    const e = /** @type {{code?: string, message?: string}} */ (err);
    const truncated = e?.code === 'Z_BUF_ERROR' || /unexpected end of file/i.test(String(e?.message));
    if (!truncated) throw err;
    process.stderr.write(`        note: ${path.replace(/^.*\//, '')} is truncated — using the records read before the cut\n`);
  }
  if (buf.trim()) {
    try {
      yield JSON.parse(buf);
    } catch {
      /* trailing partial line */
    }
  }
}

/** @param {string} dir @param {RegExp} match */
async function filesIn(dir, match) {
  try {
    return (await readdir(dir))
      .filter((f) => match.test(f))
      .sort()
      .map((f) => resolve(dir, f));
  } catch (err) {
    if (/** @type {any} */ (err).code === 'ENOENT') return [];
    throw err;
  }
}

/** @param {string} path */
async function readArray(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (/** @type {any} */ (err).code === 'ENOENT') {
      console.warn(`missing ${path} — run \`node pipeline/fetch-samples.mjs\` first`);
      return [];
    }
    throw err;
  }
}
