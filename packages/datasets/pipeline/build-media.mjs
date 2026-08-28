#!/usr/bin/env node
/**
 * Exercise demo media pipeline: two upstream stills -> one looping WebP.
 *
 *   node pipeline/build-media.mjs --acknowledge-provenance-risk [--limit 20]
 *
 * ── Why it is gated ────────────────────────────────────────────────────────
 * The `--acknowledge-provenance-risk` flag is not ceremony. The upstream image
 * provenance is unresolved (NOTICE.md §3.2): the repository is Unlicense, but
 * the photographs arrived through two hops of undocumented history, and a
 * downstream repository cannot grant rights it never held. Text ships now;
 * publishing these images to a CDN is a decision for the project owner.
 *
 * Everything the pipeline emits is traceable: `provenance.json` records the
 * source URL and SHA-256 of every input, so if the answer comes back wrong,
 * withdrawing the affected assets is one pass, not an investigation.
 *
 * ── Why a looping WebP and never a video ──────────────────────────────────
 * Constitution rule 3 forbids video hosting. An animated WebP is a sequence of
 * still frames in an image container: it is served as a plain file, decoded by
 * the image pipeline, needs no player, no transcode ladder, no streaming
 * server, and costs nothing beyond bytes on a CDN. Two frames at 1.2 s each
 * shows the start and end position of the movement, which is all a
 * demonstration needs.
 *
 * ── Requirements ───────────────────────────────────────────────────────────
 * `img2webp` (from libwebp) and `sips` (macOS) or `ffmpeg` for resizing.
 * The script reports what is missing rather than producing broken output.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';

import { MEDIA_BUDGET, MEDIA_VERSION, jsdelivrUrl } from '../src/media.mjs';

const run = promisify(execFile);

/** Set by requireTools(); macOS `sips` is preferred over ffmpeg for a plain resize. */
let HAS_SIPS = false;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

if (!argv.includes('--acknowledge-provenance-risk')) {
  console.error(
    [
      '',
      'Refusing to build exercise media.',
      '',
      'The provenance of the free-exercise-db demonstration images is not',
      'established. The repository carries an Unlicense, but the photographs',
      'reached it through two hops of undocumented history, and a downstream',
      'repository cannot grant rights it never held.',
      '',
      'Read packages/datasets/NOTICE.md §3.2 before going further. Building',
      'locally to evaluate the pipeline is fine; publishing the output to a CDN',
      'is a decision for the project owner.',
      '',
      'To build anyway:  --acknowledge-provenance-risk',
      '',
    ].join('\n'),
  );
  process.exit(2);
}

const inputDir = resolve(ROOT, flag('--input', 'build'));
const outRoot = resolve(ROOT, flag('--out', 'build/media'));
const cacheDir = resolve(ROOT, 'raw/media-src');
const limit = Number(flag('--limit', '0')) || Infinity;
const assetDir = resolve(outRoot, 'assets/exercise', MEDIA_VERSION);

await requireTools();

const catalogue = JSON.parse(
  gunzipSync(await readFile(resolve(inputDir, 'exercises.json.gz'))).toString('utf8'),
);

await mkdir(assetDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });

/** @type {any[]} */
const assets = [];
/** @type {any[]} */
const provenance = [];
/** @type {string[]} */
const skipped = [];
/** @type {string[]} */
const overBudget = [];

let processed = 0;
for (const ex of catalogue.exercises) {
  if (processed >= limit) break;
  const frames = ex.upstreamImages ?? [];
  if (frames.length < 1) {
    skipped.push(`${ex.id}: no upstream frames`);
    continue;
  }
  processed++;

  /** @type {string[]} */
  const localFrames = [];
  /** @type {any[]} */
  const inputs = [];
  let failed = false;

  for (const [i, url] of frames.slice(0, MEDIA_BUDGET.maxFrames).entries()) {
    const src = resolve(cacheDir, `${ex.id}-${i}.jpg`);
    const bytes = await fetchCached(url, src);
    if (!bytes) {
      failed = true;
      break;
    }
    inputs.push({
      url,
      bytes: bytes.length,
      sha256: `sha256-${createHash('sha256').update(bytes).digest('base64')}`,
    });
    const scaled = resolve(cacheDir, `${ex.id}-${i}-${MEDIA_BUDGET.widthPx}.jpg`);
    await resize(src, scaled, MEDIA_BUDGET.widthPx);
    localFrames.push(scaled);
  }
  if (failed || localFrames.length === 0) {
    skipped.push(`${ex.id}: could not fetch frames`);
    continue;
  }

  const out = resolve(assetDir, `${ex.id}.webp`);
  await encodeLoop(localFrames, out);
  const body = await readFile(out);

  if (body.length > MEDIA_BUDGET.maxBytesPerAsset) {
    // Retry once at the fallback quality rather than silently shipping an
    // over-budget asset. The budget is a promise about download size, and one
    // 400 KB demo is 8 exercises' worth of everyone else's budget.
    await encodeLoop(localFrames, out, MEDIA_BUDGET.fallbackQuality);
  }
  const final = await readFile(out);
  if (final.length > MEDIA_BUDGET.maxBytesPerAsset) overBudget.push(`${ex.id} (${final.length} B)`);

  assets.push({
    id: ex.id,
    file: `${ex.id}.webp`,
    format: 'webp',
    frames: localFrames.length,
    bytes: final.length,
    sha256: `sha256-${createHash('sha256').update(final).digest('base64')}`,
    url: jsdelivrUrl(ex.id, 'webp'),
  });
  provenance.push({ id: ex.id, inputs, licenceClaim: 'Unlicense (unverified — NOTICE.md §3.2)' });
}

const totalBytes = assets.reduce((n, a) => n + a.bytes, 0);
const projectedTotal = catalogue.count * (totalBytes / Math.max(1, assets.length));

const manifest = {
  mediaVersion: MEDIA_VERSION,
  builtAt: new Date().toISOString(),
  budget: MEDIA_BUDGET,
  cdn: {
    provider: 'jsDelivr',
    pattern: jsdelivrUrl('{exerciseId}', 'webp'),
    immutable: true,
    note:
      'Paths are pinned to a git tag, so a published URL never changes content. ' +
      'A new media version means a new tag and a new path, never an overwrite.',
  },
  assets: assets.length,
  totalBytes,
  meanBytes: assets.length ? Math.round(totalBytes / assets.length) : 0,
  projectedFullCatalogueBytes: Math.round(projectedTotal),
  overBudget,
  skipped: skipped.length,
  provenanceRisk: 'unresolved — see packages/datasets/NOTICE.md §3.2',
  items: assets,
};

await writeFile(resolve(outRoot, 'media-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  resolve(outRoot, 'provenance.json'),
  `${JSON.stringify({ mediaVersion: MEDIA_VERSION, source: catalogue.source, items: provenance }, null, 2)}\n`,
);

console.log(`media   ${assets.length} assets, mean ${fmtKb(manifest.meanBytes)}, total ${fmtKb(totalBytes)}`);
console.log(
  `budget  ${fmtKb(MEDIA_BUDGET.maxBytesPerAsset)}/asset, ` +
    `${overBudget.length} over budget${overBudget.length ? `: ${overBudget.join(', ')}` : ''}`,
);
console.log(
  `project ${catalogue.count} exercises x mean = ${(projectedTotal / 1024 / 1024).toFixed(1)} MB ` +
    `for the full catalogue`,
);
if (skipped.length) console.log(`skipped ${skipped.length} (${skipped.slice(0, 3).join('; ')}${skipped.length > 3 ? ' …' : ''})`);

/** @param {string[]} frames @param {string} out @param {number} [quality] */
async function encodeLoop(frames, out, quality = MEDIA_BUDGET.quality) {
  const args = ['-loop', '0', '-min_size', '-lossy', '-q', String(quality), '-m', '6'];
  for (const f of frames) args.push('-d', String(MEDIA_BUDGET.frameDurationMs), f);
  args.push('-o', out);
  await run('img2webp', args);
}

/** @param {string} src @param {string} out @param {number} width */
async function resize(src, out, width) {
  if (HAS_SIPS) {
    await run('sips', ['-Z', String(width), src, '--out', out]);
  } else {
    await rm(out, { force: true });
    await run('ffmpeg', ['-loglevel', 'error', '-i', src, '-vf', `scale=${width}:-2`, out]);
  }
}

/**
 * Fetch once, keep in `raw/media-src/` (gitignored). 873 exercises is ~1750
 * images; re-downloading them on every run would be rude to GitHub and slow.
 * @param {string} url @param {string} path
 */
async function fetchCached(url, path) {
  try {
    return await readFile(path);
  } catch {
    /* not cached yet */
  }
  const res = await fetch(url, { headers: { 'user-agent': 'TheFreeForeverFitnessApp/0.1 media pipeline' } });
  if (!res.ok) return null;
  const body = Buffer.from(await res.arrayBuffer());
  await writeFile(path, body);
  return body;
}

async function requireTools() {
  /** @type {string[]} */
  const missing = [];
  try {
    await run('img2webp', ['-version']);
  } catch {
    missing.push('img2webp (brew install webp / apt install webp)');
  }
  try {
    await run('sips', ['--help']);
    HAS_SIPS = true;
  } catch {
    try {
      await run('ffmpeg', ['-version']);
    } catch {
      missing.push('sips or ffmpeg, for resizing');
    }
  }
  if (missing.length) {
    console.error(`missing tools:\n  ${missing.join('\n  ')}`);
    process.exit(3);
  }
}

/** @param {number} n */
function fmtKb(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}

/** @param {string} name @param {string} fallback */
function flag(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? /** @type {string} */ (argv[i + 1]) : fallback;
}
