/**
 * @freeforever/datasets — public entry point.
 *
 * What the app imports. Everything under `pipeline/` is build tooling and is
 * not part of this surface.
 *
 * WHY THIS PACKAGE IS PLAIN JS WITH HAND-WRITTEN TYPES, in a TypeScript repo:
 * it has no build step and no dependencies, so it runs identically in Node, in
 * a browser tab, in a service worker, and in CI, with nothing installed. The
 * pipeline has to run before anything is installed (it produces the data the
 * app is built against), and a reader that needs compiling before it can be
 * tested is a reader that gets tested less. `index.d.ts` gives consumers the
 * same strict types they would get from source.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export { FoodIndex, FoodIndexSet, attributionUrl } from './reader.mjs';
export { MEDIA_BUDGET, MEDIA_VERSION, jsdelivrUrl, rawGithubUrl } from './media.mjs';
export { fold, tokenise } from './text.mjs';
export {
  SCHEMA_VERSION,
  SHARD,
  SHARD_LICENCE,
  SHARD_NAME,
  SOURCE,
  SOURCE_NAME,
} from './schema.mjs';

/**
 * Fetch, decompress and open an index shard.
 *
 * Split out so the caller controls caching: in the app this should run behind
 * the service worker with a Cache Storage entry keyed on the versioned URL, so
 * the artefacts are downloaded once per index release and never again.
 *
 * @param {{records:string, search?:string, barcodes?:string}} urls
 * @param {{fetchImpl?:typeof fetch, signal?:AbortSignal}} [opts]
 * @returns {Promise<import('./reader.mjs').FoodIndex>}
 */
export async function openIndexFromUrls(urls, opts = {}) {
  const { FoodIndex } = await import('./reader.mjs');
  const f = opts.fetchImpl ?? fetch;

  /** @param {string} url */
  const load = async (url) => {
    const res = await f(url, opts.signal ? { signal: opts.signal } : {});
    if (!res.ok) throw new Error(`index fetch failed: ${res.status} ${url}`);
    return gunzip(new Uint8Array(await res.arrayBuffer()));
  };

  const [records, search, barcodes] = await Promise.all([
    load(urls.records),
    urls.search ? load(urls.search) : Promise.resolve(undefined),
    urls.barcodes ? load(urls.barcodes) : Promise.resolve(undefined),
  ]);

  return new FoodIndex({
    records,
    ...(search ? { search } : {}),
    ...(barcodes ? { barcodes } : {}),
  });
}

/**
 * Decompress a gzip body.
 *
 * Uses `DecompressionStream` where available. A server may or may not have
 * already decompressed the body for us depending on how it set
 * `content-encoding`, so a non-gzip buffer is passed through rather than
 * treated as an error — the artefact's magic bytes are the real check, and
 * `readContainer` performs it.
 *
 * @param {Uint8Array} buf
 * @returns {Promise<Uint8Array>}
 */
export async function gunzip(buf) {
  const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
  if (!isGzip) return buf;

  if (typeof DecompressionStream === 'function') {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const { gunzipSync } = await import('node:zlib');
  return new Uint8Array(gunzipSync(buf));
}
