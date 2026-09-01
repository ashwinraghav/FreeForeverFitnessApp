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
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { SHARD, SHARD_LICENCE, SHARD_NAME, SCHEMA_VERSION } from '../src/schema.mjs';
import { dedupe } from './lib/dedupe.mjs';
import { encodeBarcodes, encodeRecords, encodeSearch } from './lib/encode.mjs';
import { rankAll } from './lib/rank.mjs';
import { shardOf, toNdjson } from './lib/record.mjs';
import { isPackaged, streamingSelect } from './lib/select.mjs';
import { loadOff, loadUsda } from './lib/corpus.mjs';
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
const inputDir = resolve(ROOT, opts.input);
const usda = await loadUsda(inputDir);
const off = await loadOff(inputDir);
console.log(`input   usda: ${usda.describe}\n        off:  ${off.describe}`);

/** @type {import('./lib/record.mjs').CanonicalRecord[]} */
const mapped = [];
const read = { usda: 0, off: 0 };
let rejected = 0;

// Map and select in one streaming pass. On the full corpora this is ~5.1M rows
// and the survivors are a few percent of them; materialising the intermediate
// would need tens of gigabytes for records that are about to be thrown away.
/** @type {import('./lib/select.mjs').SelectionStats} */
let selection = /** @type {any} */ (null);
const selector = streamingSelect(mapped);

for await (const row of usda.rows) {
  read.usda++;
  const r = mapFood(row);
  if (r) selector.offer(r);
  else rejected++;
  if (read.usda % 250_000 === 0) progress();
}
for await (const row of off.rows) {
  read.off++;
  const r = mapProduct(row);
  if (r) selector.offer(r);
  else rejected++;
  if (read.off % 250_000 === 0) progress();
}
selection = selector.stats;

console.log(`loaded  usda=${read.usda} off=${read.off}`);
console.log(
  `mapped  ${selection.input} kept, ${rejected} rejected by validation`,
);
console.log(
  `select  ${mapped.length} pass the entry rules ` +
    `(ingredients ${selection.keptIngredient}/${selection.ingredient}, ` +
    `packaged ${selection.keptPackaged}/${selection.packaged})`,
);
console.log(
  `        packaged rejected: no serving grams ${selection.noServingGrams}, ` +
    `no serving label ${selection.noServingLabel}, ` +
    `mass-only label ${selection.massOnlyLabel}, ` +
    `inconsistent ${selection.inconsistent} of ${selection.consistencyChecked} checkable; ` +
    `unindexable name ${selection.unindexableName} (any source)`,
);

// The per-serving witness has done its job. It is a build-time audit field and
// never reaches an artefact; dropping it here frees it before ranking sorts a
// few hundred thousand records.
for (const r of mapped) delete r.reportedPerServing;

const ranked = rankAll(mapped, { locale: opts.locale });
const { records: deduped, stats } = dedupe(ranked);
console.log(
  `dedupe  ${stats.input} -> ${stats.output} ` +
    `(gtin ${stats.byGtinWithinShard}, off-suppressed-by-core ${stats.offSuppressedByCore}, ` +
    `fingerprint ${stats.byFingerprint}, product-cluster ${stats.byProductCluster})`,
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

  const { records, encoded, droppedForBudget, reserved } = fitToBudget(all, shardId, budgets[name]);
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
    reservedIngredients: reserved,
    droppedForBudget,
    gzipBytes: gzTotal,
    bytesPerRecord: +(gzTotal / records.length).toFixed(1),
  };
  console.log(
    `${name.padEnd(6)}  ${records.length}/${all.length} records, ` +
      `${fmtMb(gzTotal)} gz (${(gzTotal / records.length).toFixed(1)} B/record)` +
      (reserved ? `, ${reserved} reserved` : '') +
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
  // Persisted because the interesting question about an index is not how many
  // records it has but what it refused. "2,278 India rows excluded for a
  // mass-only serving label" is a decision someone should be able to audit
  // months later without re-running a 15-minute ingest.
  selection: selection,
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
  // Records the budget may never drop. The locale-independent ingredient corpus
  // — USDA Foundation and SR Legacy, ~8,100 records at 258 KB, 6.3% of a 4 MB
  // budget — is the set that must answer offline for a user anywhere: dal,
  // rice, atta, chicken, eggs, ghee, oats. It is also the cheapest thing in the
  // index per byte, at ~33 B/record, because comma-chained generic names share
  // prefixes and compress well.
  //
  // Today every one of them happens to survive the cut. That is luck of
  // ranking, not construction, and ADR-0030 rule 2 (local-first is not
  // negotiable) is exactly the thing that must not be left to luck: a ranking
  // change could drop the plain foods and nothing would fail.
  const reserved = all.map((r) => !isPackaged(r));
  const reservedCount = reserved.filter(Boolean).length;

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
  if (full.size <= budget) {
    return { records: all, encoded: full.encoded, droppedForBudget: 0, reserved: reservedCount };
  }

  // Take every reserved record plus the best `n` of the rest, keeping the
  // original relative order so that record order still IS rank order — the
  // reader's popularity prior reads `doc`, so reordering here would corrupt it.
  const take = (/** @type {number} */ n) => {
    const out = [];
    let taken = 0;
    for (let i = 0; i < all.length; i++) {
      if (reserved[i]) out.push(/** @type {any} */ (all[i]));
      else if (taken < n) {
        out.push(/** @type {any} */ (all[i]));
        taken++;
      }
    }
    return out;
  };

  const optional = all.length - reservedCount;
  let lo = 0;
  let hi = optional;
  let best = { n: 0, ...measure(take(0)) };
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = measure(take(mid));
    if (r.size <= budget) {
      best = { n: mid, ...r };
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const records = take(best.n);
  return {
    records,
    encoded: best.encoded,
    droppedForBudget: all.length - records.length,
    reserved: reservedCount,
  };
}

/** Heartbeat for a full ingest, which reads ~5.1M rows and takes minutes. */
function progress() {
  const mb = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0);
  console.log(
    `        read usda=${read.usda} off=${read.off} -> ${mapped.length} selected ` +
      `(${((Date.now() - t0) / 1000).toFixed(0)}s, ${mb} MB heap)`,
  );
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
    // Sample builds write to build-sample/, NOT over build/, and NOT inside it.
    //
    // `build/` is the shipped index: `apps/web/scripts/sync-datasets.mjs`
    // copies from it and nutrition's recall suite measures against it. When the
    // default was `build/`, every fixture build silently replaced a 97,294-record
    // corpus with a 571-record sample, and the only symptom was another team's
    // recall numbers quietly measuring the wrong thing. Iteration should be the
    // thing that moves, not the shipped output.
    //
    // A sibling directory rather than `build/sample/` because that sync is
    // `cpSync(build, public/data, { recursive: true })` — it copies whatever it
    // finds, so anything parked under build/ joins the web app's deploy payload.
    out: val('--out', 'build-sample'),
    locale: val('--locale', 'us'),
    budgetBytes: Number(val('--budget-mb', '4')) * 1024 * 1024,
    version: val('--version', `${now.getUTCFullYear()}.${String(now.getUTCMonth() + 1).padStart(2, '0')}.1`),
  };
}
