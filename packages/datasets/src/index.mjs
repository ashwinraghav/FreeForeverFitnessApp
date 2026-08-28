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
export { gunzip } from './gunzip.mjs';
/**
 * Re-exported for convenience. ⚠ `openExerciseCatalogue()` loads 213 KB gzipped
 * / 1.66 MB parsed — never call it at module scope. Prefer
 * `await import('@freeforever/datasets/exercises')` so the reader itself stays
 * out of the eager graph. See src/exercises.mjs.
 */
export { ExerciseCatalogue, CATALOGUE_SIZE, openExerciseCatalogue } from './exercises.mjs';
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
    const { gunzip } = await import('./gunzip.mjs');
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

