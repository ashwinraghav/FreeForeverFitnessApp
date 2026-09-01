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
import { atwaterKcal } from './lib/nutrients.mjs';
import { PROBES, runProbes } from './lib/probes.mjs';
import { SHARD_NAME } from '../src/schema.mjs';
import { tokenise } from '../src/text.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const dir = resolve(ROOT, flag('--dir', 'build'));
const releaseMode = argv.includes('--release');
/**
 * Acceptance probes name real foods and only make sense against a full build —
 * the committed sample holds 600 products and cannot contain them. `--release`
 * implies them: shipping an index that has lost the foods a user asked for is
 * exactly the failure they are here to stop.
 */
const probeMode = releaseMode || argv.includes('--probes');

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
/** @type {Record<string, FoodIndex>} */
const readers = {};

for (const [shard, b] of bodies) {
  if (!b.records) continue;
  const idx = new FoodIndex({
    records: b.records,
    ...(b.search ? { search: b.search } : {}),
    ...(b.barcodes ? { barcodes: b.barcodes } : {}),
  });
  readers[shard] = idx;
  check(`${shard}: reader reports the manifest's record count`, idx.length === manifest.shards[shard].shipped);
  check(`${shard}: reader shard id matches its filename`, idx.shardName === shard);

  let decoded = 0;
  let ingredients = 0;
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
    // Must mirror `isPackaged()` in lib/select.mjs exactly, which is what
    // `fitToBudget` reserves on. Source alone is not the definition: a Branded
    // record with neither a brand nor a barcode counts as an ingredient too, and
    // counting by source undercounted by 3 and reported a reservation failure
    // that had not happened.
    if (
      food.source === 'usda-foundation' ||
      food.source === 'usda-sr-legacy' ||
      (!food.brand && !food.barcode)
    ) {
      ingredients++;
    }

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
    //
    // Compare against the Atwater estimate rather than against "any macro is
    // non-zero". A product stating 0.1 g of protein and nothing else really
    // does have 0.4 kcal per 100 g, and the kcal column is integers, so zero
    // is the correctly-rounded value and not a regression. The earlier form
    // reported ten of those as failures.
    if (kcal === 0 && atwaterKcal(food.per100) >= 0.5) {
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
      // Probe with the CONJUNCTION of the record's own terms, not its first
      // term alone.
      //
      // The single-term version was written against a 486-record sample, where
      // `limit: 500` returned the whole shard and so "is it in the results"
      // meant "is it in the index". At full-corpus scale that stops being true
      // and the check becomes unpassable by construction: 1,619 core records
      // match "beef", so 1,119 of them are absent from the top 500 no matter
      // how correct the index is. It reported 403 failures on a build where
      // every one of those records was present and reachable.
      //
      // What the check is actually for is dead weight — a record no query can
      // reach. The conjunction of a record's own indexed terms is the query a
      // user converges on as they type, it is selective enough to fit inside
      // the limit, and it still fails loudly if a record is missing from the
      // postings of any of its own terms.
      //
      // The limit is the whole shard, deliberately. "Is this record in the
      // postings for its own terms" is the dead-weight question; "is it in the
      // top twenty a user sees" is a relevance question, and answering the
      // second one here is what made this check unpassable. Relevance is what
      // `lib/probes.mjs` is for.
      const query = terms.slice(0, 6).join(' ');
      if (idx.search(query, { limit: idx.length }).some((h) => h.food.id === food.id)) searchHits++;
      else fail(`${shard}: ${JSON.stringify(food.name)} is not findable by its own terms "${query}"`);
    }
  }

  check(`${shard}: all ${decoded} records decode`, decoded === idx.length);

  // The reservation, asserted on the artefact rather than trusted from the
  // build. `fitToBudget` promises the locale-independent ingredient corpus is
  // never dropped for budget; this is what makes that a constraint instead of a
  // comment. It catches the regression the reservation exists to prevent — a
  // ranking change quietly pushing plain foods below the cut — because the
  // manifest's count comes from the candidate pool while this one comes from
  // what actually shipped.
  const declaredReserved = manifest.shards[shard]?.reservedIngredients;
  if (declaredReserved != null) {
    check(
      `${shard}: every reserved ingredient shipped (${ingredients}/${declaredReserved})`,
      ingredients === declaredReserved,
      `${declaredReserved - ingredients} locale-independent ingredient record(s) were dropped for budget`,
    );
  }
  if (probeMode && shard === 'core') {
    // A floor as well as an equality, so that losing ingredients upstream —
    // a source that stops parsing, a gate that tightens — cannot pass merely by
    // making the build declare a smaller reservation.
    check(
      `${shard}: the ingredient corpus is intact (${ingredients} records)`,
      ingredients >= 8000,
      `expected ~8,100 USDA Foundation + SR Legacy records, found ${ingredients}`,
    );
  }
  check(
    `${shard}: every record has at least one indexable term (${idx.length - unindexable}/${idx.length})`,
    unindexable === 0,
    `${unindexable} record(s) cannot be reached by any query`,
  );
  // 100%, not a threshold. Anything less is a record no query built from its
  // own name can reach, and there is no legitimate reason for one — the
  // stopword case is handled by probing indexed terms, and the "thousands of
  // records share my first word" case by probing their conjunction.
  check(
    `${shard}: sampled records are findable by their own indexed terms (${searchHits}/${searchProbes})`,
    searchHits === searchProbes,
    `${searchProbes - searchHits} of ${searchProbes} probes could not find themselves`,
  );
  if (withBarcode > 0) {
    check(`${shard}: sampled barcodes resolve`, barcodeHits > 0, 'no sampled barcode resolved');
  }
}

// ── acceptance probes: named foods a shipped index must still contain ──────
if (probeMode) {
  for (const r of runProbes(readers)) {
    check(`probe ${r.id}`, r.ok, r.detail);
    if (r.ok) console.log(`      ${r.detail}`);
  }
} else {
  console.log(
    `note  ${PROBES.length} acceptance probes skipped — pass --probes (or --release) ` +
      'to run them against a full build',
  );
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
