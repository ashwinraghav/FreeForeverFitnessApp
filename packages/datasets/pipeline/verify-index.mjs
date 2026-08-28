#!/usr/bin/env node
/**
 * Verify a built index.
 *
 * Half of this is integrity (hashes match, records decode, search finds what it
 * indexed). The other half is licence compliance, and that half is the reason
 * this file exists rather than being folded into the build: the compliance
 * invariants in NOTICE.md are only real if something fails the build when they
 * break. A comment saying "never merge OFF into core" is a wish. A test that
 * fails is a constraint.
 *
 *   node pipeline/verify-index.mjs [--dir build] [--release]
 *
 * Exit code 1 on any failure. Wire it into CI.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { FoodIndex } from '../src/reader.mjs';
import { SHARD_NAME } from '../src/schema.mjs';
import { tokenise } from '../src/text.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const dir = resolve(ROOT, flag('--dir', 'build'));
const releaseMode = argv.includes('--release');

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const warnings = [];

const manifest = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8'));
const files = new Set(await readdir(dir));

check('manifest declares a schema version', manifest.schemaVersion > 0);
check('manifest declares an index version', typeof manifest.indexVersion === 'string');

// ── integrity ──────────────────────────────────────────────────────────────
/** @type {Map<string, Record<string, Uint8Array>>} */
const bodies = new Map();

for (const artefact of manifest.artefacts ?? []) {
  /** @type {Record<string, Uint8Array>} */
  const shardBodies = {};
  for (const f of artefact.files) {
    if (!files.has(f.file)) {
      fail(`${artefact.shard}: declared file ${f.file} is missing from ${dir}`);
      continue;
    }
    const gz = await readFile(resolve(dir, f.file));
    const actual = `sha256-${createHash('sha256').update(gz).digest('base64')}`;
    check(`${f.file} integrity hash matches`, actual === f.sha256);
    check(`${f.file} declared gzip size matches`, gz.length === f.gzipBytes);
    if (!f.role.startsWith('ndjson')) shardBodies[f.role] = gunzipSync(gz);
  }
  bodies.set(artefact.shard, shardBodies);
}

// ── the index actually works ───────────────────────────────────────────────
for (const [shard, b] of bodies) {
  if (!b.records) continue;
  const idx = new FoodIndex({
    records: b.records,
    ...(b.search ? { search: b.search } : {}),
    ...(b.barcodes ? { barcodes: b.barcodes } : {}),
  });
  check(`${shard}: reader reports the manifest's record count`, idx.length === manifest.shards[shard].shipped);
  check(`${shard}: reader shard id matches its filename`, idx.shardName === shard);

  let decoded = 0;
  let withBarcode = 0;
  let barcodeHits = 0;
  let searchHits = 0;
  let searchProbes = 0;
  let unindexable = 0;
  // Sample densely. A search is ~11 microseconds, so probing a couple of
  // thousand records costs milliseconds and makes the recall figure mean
  // something. An earlier version probed 1-in-N and reported the shortfall as
  // `ok`, which is how a check teaches people to ignore it.
  const probe = Math.max(1, Math.floor(idx.length / 2000));

  for (let i = 0; i < idx.length; i++) {
    const food = idx.get(i);
    if (!food) {
      fail(`${shard}: record ${i} failed to decode`);
      break;
    }
    decoded++;

    // Compliance: no OFF-sourced record may appear in the core shard, and no
    // core-sourced record in the OFF shard. NOTICE.md §2.4.
    if (shard === SHARD_NAME[0] && food.source === 'off') {
      fail(`${shard}: record ${i} (${food.sourceId}) is OFF-sourced but landed in the core shard`);
    }
    if (shard === SHARD_NAME[1] && !food.source.startsWith('off')) {
      fail(`${shard}: record ${i} (${food.sourceId}) is ${food.source} but landed in the OFF shard`);
    }

    // Compliance: every OFF record must carry an attribution link. NOTICE.md §2.2.
    if (food.source === 'off') {
      if (!food.sourceId) fail(`${shard}: an OFF record has no barcode, so it cannot be credited`);
      if (!food.attributionUrl?.startsWith('https://world.openfoodfacts.org/product/')) {
        fail(`${shard}: OFF record ${food.sourceId} has no product attribution URL`);
      }
    }

    // A record with no energy and no macros is only legitimate when upstream
    // explicitly said "zero" — diet soda, black coffee, vinegar. Without that
    // flag it is missing data that would show a user 0 kcal for real food.
    const { kcal, proteinG, carbG, fatG } = food.per100;
    if (
      kcal === 0 &&
      proteinG === 0 &&
      carbG === 0 &&
      fatG === 0 &&
      !food.flags.energyReported &&
      !food.flags.energyDerived
    ) {
      fail(`${shard}: record ${food.sourceId} carries no usable nutrients and no reported zero`);
    }

    // A food with macros but zero energy should have had energy derived. If one
    // reaches the artefact, fillEnergy() has regressed and users see 0 kcal.
    if (kcal === 0 && (proteinG > 0 || carbG > 0 || fatG > 0)) {
      fail(`${shard}: record ${food.sourceId} has macros but zero energy`);
    }

    if (food.flags.hasBarcode) {
      withBarcode++;
      if (!food.barcode) {
        fail(`${shard}: record ${food.sourceId} is flagged as having a barcode but exposes none`);
      } else if (i % probe === 0 && idx.byBarcode(food.barcode)?.sourceId === food.sourceId) {
        barcodeHits++;
      }
    }

    // A record nobody can type their way to is dead weight in the download.
    //
    // Probe by the record's first INDEXED term, not by the first word of its
    // display name. Those differ whenever a name opens with a stopword — "The
    // Madelaine Chocolate Company", "De Nigris" — and the display-name version
    // of this check reported those as failures when the index was correct and
    // the probe was wrong. Query text is folded through the same `tokenise()`,
    // so a user typing "de nigris" searches for `nigris` too and finds it.
    const terms = tokenise(food.name);

    if (terms.length === 0) {
      // The genuine unfindable case, and the one the old check could not see: a
      // name made entirely of stopwords, punctuation or single characters has
      // no index term at all. Rare, but it is real dead weight.
      unindexable++;
      fail(`${shard}: record ${food.sourceId} (${JSON.stringify(food.name)}) has no indexable term`);
    } else if (i % probe === 0) {
      searchProbes++;
      if (idx.search(terms[0], { limit: 500 }).some((h) => h.food.id === food.id)) searchHits++;
      else fail(`${shard}: ${JSON.stringify(food.name)} is not findable by its own term "${terms[0]}"`);
    }
  }

  check(`${shard}: all ${decoded} records decode`, decoded === idx.length);
  check(
    `${shard}: every record has at least one indexable term (${idx.length - unindexable}/${idx.length})`,
    unindexable === 0,
    `${unindexable} record(s) cannot be reached by any query`,
  );
  // 100%, not a threshold. Anything less is a record a user cannot find by
  // typing a word that is literally in its name, and there is no legitimate
  // reason for one — the stopword case is handled by probing indexed terms.
  check(
    `${shard}: sampled records are findable by their own first indexed term (${searchHits}/${searchProbes})`,
    searchHits === searchProbes,
    `${searchProbes - searchHits} of ${searchProbes} probes could not find themselves`,
  );
  if (withBarcode > 0) {
    check(`${shard}: sampled barcodes resolve`, barcodeHits > 0, 'no sampled barcode resolved');
  }
}

// ── licence compliance that lives outside the binary ───────────────────────
const off = (manifest.artefacts ?? []).find((/** @type {any} */ a) => a.shard === 'off');
if (off) {
  check(
    'OFF shard is declared ODbL-1.0',
    off.licence === 'ODbL-1.0',
    `declared as ${off.licence}`,
  );
  check(
    'OFF shard ships the plain NDJSON parallel distribution (ODbL §4.6)',
    off.files.some((/** @type {any} */ f) => f.role === 'ndjson-parallel-distribution'),
  );
  check(
    'OFF shard ships a NOTICE.txt',
    [...files].some((f) => f.startsWith('food-off-') && f.endsWith('.NOTICE.txt')),
  );

  const ndjsonFile = off.files.find((/** @type {any} */ f) => f.role === 'ndjson-parallel-distribution');
  if (ndjsonFile && files.has(ndjsonFile.file)) {
    const text = gunzipSync(await readFile(resolve(dir, ndjsonFile.file))).toString('utf8');
    const lines = text.split('\n').filter(Boolean);
    check('NDJSON dump is non-empty', lines.length > 0);
    check(
      'NDJSON dump carries no image field (NOTICE.md §2.5)',
      !/"image[^"]*"\s*:/i.test(text),
      'an image key appeared in the OFF-derived output',
    );
    check(
      'every NDJSON record carries its barcode for attribution',
      lines.every((l) => {
        try {
          return Boolean(JSON.parse(l).barcode);
        } catch {
          return false;
        }
      }),
    );
  }
}

const coreArtefact = (manifest.artefacts ?? []).find((/** @type {any} */ a) => a.shard === 'core');
if (coreArtefact) {
  check(
    'core shard is declared public domain',
    coreArtefact.licence === 'public-domain-usgov',
    `declared as ${coreArtefact.licence}`,
  );
  check(
    'core shard does not ship an ODbL notice',
    !coreArtefact.files.some((/** @type {any} */ f) => /NOTICE/.test(f.file)),
    'a NOTICE beside the core shard suggests OFF data leaked into it',
  );
}

check(
  'sources are declared with their licences',
  Array.isArray(manifest.sources) &&
    manifest.sources.length >= 2 &&
    manifest.sources.every((/** @type {any} */ s) => s.licence && s.attribution),
);

// The NOTICE is only accurate as of the day someone read the upstream terms.
const verifiedAt = Date.parse(manifest.licenceVerifiedAt ?? '');
if (Number.isFinite(verifiedAt)) {
  const days = (Date.now() - verifiedAt) / 86_400_000;
  if (days > 180) {
    warn(
      `upstream licence terms were last verified ${Math.round(days)} days ago — ` +
        're-read NOTICE.md against the upstream terms before releasing',
    );
  }
} else {
  fail('manifest has no licenceVerifiedAt date');
}

if (releaseMode) {
  // Publishing the derived OFF database is what discharges ODbL §4.4. Without
  // a reachable URL, the obligation is not met, so a release must declare one.
  check(
    'release declares where the ODbL derived database is published',
    typeof manifest.publishedAt === 'string' && manifest.publishedAt.startsWith('https://'),
    'set manifest.publishedAt to the public release URL before publishing (NOTICE.md §2.3)',
  );
}

// ── report ─────────────────────────────────────────────────────────────────
for (const w of warnings) console.warn(`warn  ${w}`);
if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL  ${f}`);
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log(`ok    index verified: ${bodies.size} shard(s), ${warnings.length} warning(s)`);

/** @param {string} label @param {boolean} ok @param {string} [detail] */
function check(label, ok, detail) {
  if (ok) console.log(`ok    ${label}`);
  else fail(detail ? `${label} — ${detail}` : label);
}

/** @param {string} msg */
function fail(msg) {
  failures.push(msg);
}

/** @param {string} msg */
function warn(msg) {
  warnings.push(msg);
}

/** @param {string} name @param {string} fallback */
function flag(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? /** @type {string} */ (argv[i + 1]) : fallback;
}
