#!/usr/bin/env node
/**
 * Build the on-device food index.
 *
 *   node pipeline/build-food-index.mjs [--input fixtures] [--out build]
 *                                      [--budget-mb 4] [--locale us]
 *
 * Stages: load -> map -> rank -> dedupe -> shard -> fit to budget -> encode.
 *
 * The two shards are built independently and never merged. That is a licence
 * requirement, not a performance choice — see NOTICE.md §2.4.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { SHARD, SHARD_LICENCE, SHARD_NAME, SCHEMA_VERSION } from '../src/schema.mjs';
import { dedupe } from './lib/dedupe.mjs';
import { encodeBarcodes, encodeRecords, encodeSearch } from './lib/encode.mjs';
import { rankAll } from './lib/rank.mjs';
import { shardOf, toNdjson } from './lib/record.mjs';
import { mapProduct } from './sources/off.mjs';
import { mapFood } from './sources/usda.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const opts = parseArgs(process.argv.slice(2));

/**
 * Highest gzip level. The index is built once per release and downloaded by
 * every user, so build CPU is free and every byte is charged to a phone on a
 * hotel wifi. Deterministic output matters more: gzip at a fixed level over
 * identical input is byte-identical, which is what makes the integrity hash a
 * meaningful check rather than a build timestamp.
 */
const GZIP = { level: 9 };

const SOURCE_MANIFEST = [
  {
    id: 'usda-fdc',
    name: 'USDA FoodData Central',
    url: 'https://fdc.nal.usda.gov/',
    licence: 'public-domain-usgov',
    licenceUrl: 'https://www.usa.gov/government-works',
    shard: SHARD_NAME[SHARD.CORE],
    attribution:
      'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov.',
    shareAlike: false,
  },
  {
    id: 'open-food-facts',
    name: 'Open Food Facts',
    url: 'https://world.openfoodfacts.org/',
    licence: 'ODbL-1.0',
    licenceUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    contentsLicence: 'DbCL-1.0',
    shard: SHARD_NAME[SHARD.OFF],
    attribution:
      'Contains information from Open Food Facts (https://world.openfoodfacts.org), made available under the Open Database License (ODbL) v1.0.',
    shareAlike: true,
    perRecordAttributionUrl: 'https://world.openfoodfacts.org/product/{sourceId}',
    imagesExcluded: true,
  },
];

const t0 = Date.now();
const raw = await load();
console.log(`loaded  usda=${raw.usda.length} off=${raw.off.length}`);

/** @type {import('./lib/record.mjs').CanonicalRecord[]} */
const mapped = [];
let rejected = 0;
for (const f of raw.usda) {
  const r = mapFood(f);
  r ? mapped.push(r) : rejected++;
}
for (const p of raw.off) {
  const r = mapProduct(p);
  r ? mapped.push(r) : rejected++;
}
console.log(`mapped  ${mapped.length} kept, ${rejected} rejected by validation`);

const ranked = rankAll(mapped, { locale: opts.locale });
const { records: deduped, stats } = dedupe(ranked);
console.log(
  `dedupe  ${stats.input} -> ${stats.output} ` +
    `(gtin ${stats.byGtinWithinShard}, off-suppressed-by-core ${stats.offSuppressedByCore}, ` +
    `fingerprint ${stats.byFingerprint})`,
);

/** @type {Record<string, import('./lib/record.mjs').CanonicalRecord[]>} */
const shards = { core: [], off: [] };
for (const r of deduped) {
  (shardOf(r) === SHARD.CORE ? shards.core : shards.off).push(r);
}

/**
 * Split the download budget between shards. Core gets the smaller share because
 * it is the smaller corpus and because it is the one that must be present
 * before the app is usable at all; the OFF shard is the long tail of branded
 * products and can be fetched on first barcode scan.
 */
const budgets = {
  core: opts.budgetBytes * 0.3,
  off: opts.budgetBytes * 0.7,
};

const outDir = resolve(ROOT, opts.out);
await mkdir(outDir, { recursive: true });

/** @type {any[]} */
const artefacts = [];
/** @type {any} */
const shardReport = {};

for (const [name, shardId] of /** @type {Array<[keyof typeof shards, number]>} */ ([
  ['core', SHARD.CORE],
  ['off', SHARD.OFF],
])) {
  const all = shards[name] ?? [];
  if (all.length === 0) {
    console.log(`${name.padEnd(6)}  empty, skipped`);
    continue;
  }

  const { records, encoded, droppedForBudget } = fitToBudget(all, shardId, budgets[name]);
  const version = opts.version;

  const files = [
    { role: 'records', body: encoded.records },
    { role: 'search', body: encoded.search },
    { role: 'barcodes', body: encoded.barcodes },
  ];

  /** @type {any[]} */
  const written = [];
  for (const f of files) {
    const gz = gzipSync(f.body, GZIP);
    const file = `food-${name}-${f.role}-${version}.bin.gz`;
    await writeFile(resolve(outDir, file), gz);
    written.push({
      role: f.role,
      file,
      bytes: f.body.length,
      gzipBytes: gz.length,
      sha256: sha256(gz),
    });
  }

  // ODbL §4.6 parallel distribution: the OFF shard is ALSO published in a
  // plain, documented, non-binary form. See NOTICE.md §2.2 and §2.3.
  if (shardId === SHARD.OFF) {
    const ndjson = Buffer.from(`${records.map(toNdjson).join('\n')}\n`, 'utf8');
    const gz = gzipSync(ndjson, GZIP);
    const file = `food-off-${version}.ndjson.gz`;
    await writeFile(resolve(outDir, file), gz);
    written.push({
      role: 'ndjson-parallel-distribution',
      file,
      bytes: ndjson.length,
      gzipBytes: gz.length,
      sha256: sha256(gz),
    });
    await writeFile(resolve(outDir, `food-off-${version}.NOTICE.txt`), offNoticeText(version, records.length));
  }

  const gzTotal = written
    .filter((w) => w.role !== 'ndjson-parallel-distribution')
    .reduce((n, w) => n + w.gzipBytes, 0);

  artefacts.push({ shard: name, licence: SHARD_LICENCE[shardId], files: written });
  shardReport[name] = {
    candidates: all.length,
    shipped: records.length,
    droppedForBudget,
    gzipBytes: gzTotal,
    bytesPerRecord: +(gzTotal / records.length).toFixed(1),
  };
  console.log(
    `${name.padEnd(6)}  ${records.length}/${all.length} records, ` +
      `${fmtMb(gzTotal)} gz (${(gzTotal / records.length).toFixed(1)} B/record)` +
      (droppedForBudget ? `, dropped ${droppedForBudget} to fit` : ''),
  );
}

const manifest = {
  schemaVersion: SCHEMA_VERSION,
  indexVersion: opts.version,
  builtAt: new Date().toISOString(),
  locale: opts.locale,
  budgetBytes: opts.budgetBytes,
  totalGzipBytes: artefacts.reduce(
    (n, a) =>
      n + a.files.filter((/** @type {any} */ f) => !f.role.startsWith('ndjson')).reduce((m, /** @type {any} */ f) => m + f.gzipBytes, 0),
    0,
  ),
  shards: shardReport,
  dedupe: stats,
  artefacts,
  sources: SOURCE_MANIFEST,
  licenceVerifiedAt: '2026-08-28',
};

await writeFile(resolve(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `total   ${fmtMb(manifest.totalGzipBytes)} gz of a ${fmtMb(opts.budgetBytes)} budget ` +
    `in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);

/**
 * Encode, measure, and drop the lowest-ranked tail until the gzipped artefacts
 * fit the budget.
 *
 * Binary search rather than a byte-per-record estimate: compressed size is not
 * linear in record count — the term dictionary and the brand table amortise as
 * the corpus grows — so an estimate overshoots on small builds and undershoots
 * on large ones. Six encode passes is a few seconds and gets it exact.
 *
 * @param {import('./lib/record.mjs').CanonicalRecord[]} all
 * @param {number} shardId
 * @param {number} budget
 */
function fitToBudget(all, shardId, budget) {
  const measure = (/** @type {import('./lib/record.mjs').CanonicalRecord[]} */ subset) => {
    const encoded = {
      records: encodeRecords(subset, shardId),
      search: encodeSearch(subset, shardId),
      barcodes: encodeBarcodes(subset, shardId),
    };
    const size =
      gzipSync(encoded.records, GZIP).length +
      gzipSync(encoded.search, GZIP).length +
      gzipSync(encoded.barcodes, GZIP).length;
    return { encoded, size };
  };

  let full = measure(all);
  if (full.size <= budget) return { records: all, encoded: full.encoded, droppedForBudget: 0 };

  let lo = 1;
  let hi = all.length;
  let best = { n: 1, ...measure(all.slice(0, 1)) };
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = measure(all.slice(0, mid));
    if (r.size <= budget) {
      best = { n: mid, ...r };
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return {
    records: all.slice(0, best.n),
    encoded: best.encoded,
    droppedForBudget: all.length - best.n,
  };
}

async function load() {
  const dir = resolve(ROOT, opts.input);
  const usda = await readJson(resolve(dir, 'usda-sample.json'), []);
  const off = await readJson(resolve(dir, 'off-sample.json'), []);
  return { usda, off };
}

/** @param {string} path @param {any} fallback */
async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (/** @type {any} */ (err).code === 'ENOENT') {
      console.warn(`missing ${path} — run \`node pipeline/fetch-samples.mjs\` first`);
      return fallback;
    }
    throw err;
  }
}

/** @param {Uint8Array} b */
function sha256(b) {
  return `sha256-${createHash('sha256').update(b).digest('base64')}`;
}

/** @param {number} n */
function fmtMb(n) {
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** @param {string} version @param {number} count */
function offNoticeText(version, count) {
  return `TheFreeForeverFitnessApp food index — Open Food Facts shard
Index version: ${version}
Records: ${count}

Contains information from Open Food Facts (https://world.openfoodfacts.org),
made available under the Open Database License (ODbL) v1.0:
https://opendatacommons.org/licenses/odbl/1-0/

Individual contents of the database are available under the Database Contents
License: https://opendatacommons.org/licenses/dbcl/1-0/

This shard is a Derivative Database under ODbL §4.4 and is offered here under
ODbL v1.0. The same data is published in a plain, non-binary form as
food-off-${version}.ndjson.gz (ODbL §4.6, parallel distribution).

Individual contributors are credited by a link to the product they contributed
to; every record carries its barcode, and the application links each food to
https://world.openfoodfacts.org/product/<barcode>.

No Open Food Facts images are included. Product images on Open Food Facts are
CC-BY-SA and are deliberately excluded from this pipeline.

Full terms and provenance: packages/datasets/NOTICE.md
`;
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const val = (/** @type {string} */ flag, /** @type {string} */ fallback) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? /** @type {string} */ (argv[i + 1]) : fallback;
  };
  const now = new Date();
  return {
    input: val('--input', 'fixtures'),
    out: val('--out', 'build'),
    locale: val('--locale', 'us'),
    budgetBytes: Number(val('--budget-mb', '4')) * 1024 * 1024,
    version: val('--version', `${now.getUTCFullYear()}.${String(now.getUTCMonth() + 1).padStart(2, '0')}.1`),
  };
}
