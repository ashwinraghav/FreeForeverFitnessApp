/**
 * Gzip decompression, in its own module so that importing it does not drag in
 * the food reader — `src/exercises.mjs` needs it and must stay cheap to import.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Decompress a gzip body.
 *
 * Uses `DecompressionStream` where available. A server may or may not have
 * already decompressed the body depending on how it set `content-encoding`, so
 * a non-gzip buffer is passed through rather than treated as an error — the
 * artefact's own magic bytes are the real check.
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
