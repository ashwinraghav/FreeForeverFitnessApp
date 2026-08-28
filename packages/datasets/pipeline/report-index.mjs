#!/usr/bin/env node
/**
 * Size report: where the bytes go, how the alternatives compare, and how many
 * foods fit in the ADR-0006 budget.
 *
 * The budget is the whole design constraint, so it gets measured rather than
 * asserted. Two things this produces that a build log cannot:
 *
 *  1. The MARGINAL cost per record. A small build's average byte-per-record is
 *     dominated by fixed overhead (dictionaries, block index) and badly
 *     overstates the cost of the millionth record. Fitting the slope across
 *     several corpus sizes is what makes an extrapolation honest.
 *  2. A measured comparison against the index structures we did not choose,
 *     built from the same tokens, so docs/search-index-design.md cites numbers
 *     rather than folklore.
 *
 *   node pipeline/report-index.mjs [--input fixtures] [--budget-mb 4] [--json]
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { ByteWriter } from '../src/bytes.mjs';
import { readContainer } from '../src/container.mjs';
import { SECTION, SHARD } from '../src/schema.mjs';
import { tokenise } from '../src/text.mjs';
import { dedupe } from './lib/dedupe.mjs';
import { buildPostings, encodeBarcodes, encodeRecords, encodeSearch } from './lib/encode.mjs';
import { rankAll } from './lib/rank.mjs';
import { shardOf } from './lib/record.mjs';
import { mapProduct } from './sources/off.mjs';
import { mapFood } from './sources/usda.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const inputDir = resolve(ROOT, flag('--input', 'fixtures'));
const budget = Number(flag('--budget-mb', '4')) * 1024 * 1024;
const asJson = argv.includes('--json');

const GZ = { level: 9 };

const usda = await readJson(resolve(inputDir, 'usda-sample.json'));
const off = await readJson(resolve(inputDir, 'off-sample.json'));

/** @type {import('./lib/record.mjs').CanonicalRecord[]} */
const mapped = [];
for (const f of usda) {
  const r = mapFood(f);
  if (r) mapped.push(r);
}
for (const p of off) {
  const r = mapProduct(p);
  if (r) mapped.push(r);
}
const { records: all } = dedupe(rankAll(mapped));
const core = all.filter((r) => shardOf(r) === SHARD.CORE);
const offRecs = all.filter((r) => shardOf(r) === SHARD.OFF);

const report = {
  sample: { total: all.length, core: core.length, off: offRecs.length },
  sections: sectionBreakdown(all),
  structures: compareStructures(all),
  scaling: { core: scaling(core), off: scaling(offRecs) },
};

// The build splits the budget 30/70 between shards; the projection follows it.
report.projection = {
  core: project(report.scaling.core, budget * 0.3),
  off: project(report.scaling.off, budget * 0.7),
};
report.projection.totalRecordsAtBudget =
  report.projection.core.recordsAtBudget + report.projection.off.recordsAtBudget;

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  print(report);
}

/**
 * Gzipped size of each section, measured by encoding the whole artefact and
 * then gzipping each section body on its own. Section-wise gzip slightly
 * overstates the total (each stream carries its own header and loses
 * cross-section redundancy), which is why the total is reported separately.
 * @param {import('./lib/record.mjs').CanonicalRecord[]} records
 */
function sectionBreakdown(records) {
  const parts = {
    records: encodeRecords(records, SHARD.CORE),
    search: encodeSearch(records, SHARD.CORE),
    barcodes: encodeBarcodes(records, SHARD.CORE),
  };
  /** @type {any} */
  const out = { artefacts: {}, sections: {} };
  for (const [name, body] of Object.entries(parts)) {
    out.artefacts[name] = { raw: body.length, gzip: gzipSync(body, GZ).length };
    for (const [kind, section] of readContainer(body).sections) {
      out.sections[`${name}/${sectionName(kind)}`] = {
        raw: section.length,
        gzip: gzipSync(section, GZ).length,
      };
    }
  }
  out.totalGzip = Object.values(out.artefacts).reduce(
    (/** @type {number} */ n, /** @type {any} */ a) => n + a.gzip,
    0,
  );
  return out;
}

/**
 * Build three search index structures over identical tokens and measure them.
 *
 *  inverted-frontcoded : what we ship.
 *  inverted-plain      : same postings, term dictionary stored uncompressed.
 *                        Isolates what front-coding is actually worth.
 *  trigram             : every 3-gram of every term posts to the doc. The
 *                        classic answer for substring and typo tolerance.
 *  suffix-terms        : every suffix of every term indexed as its own term,
 *                        which is how you get mid-word matching out of a plain
 *                        prefix structure (a trie or FST over suffixes).
 *
 * @param {import('./lib/record.mjs').CanonicalRecord[]} records
 */
function compareStructures(records) {
  const postings = buildPostings(records);

  const encodedSearch = encodeSearch(records, SHARD.CORE);
  const searchSections = readContainer(encodedSearch).sections;
  const frontCodedDictRaw =
    (searchSections.get(SECTION.TERM_BLOCKS)?.length ?? 0) +
    (searchSections.get(SECTION.TERM_INDEX)?.length ?? 0);
  const frontCoded = gzipSync(encodedSearch, GZ).length;

  // Plain dictionary: same postings, terms written whole. Isolates what
  // front-coding buys once gzip has already had a go at a sorted term list.
  const plain = new ByteWriter(1 << 16);
  let plainDictRaw = 0;
  for (const [term, list] of [...postings.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const before = plain.len;
    plain.str(term);
    plainDictRaw += plain.len - before;
    plain.varint(list.length);
    let prev = 0;
    for (const { doc, field } of [...list].sort((a, b) => a.doc - b.doc)) {
      plain.varint(((doc - prev) << 2) | field);
      prev = doc;
    }
  }

  return {
    'inverted-frontcoded': {
      terms: postings.size,
      gzip: frontCoded,
      dictRaw: frontCodedDictRaw,
    },
    'inverted-plain': {
      terms: postings.size,
      gzip: gzipSync(plain.finish(), GZ).length,
      dictRaw: plainDictRaw,
    },
    trigram: measureDerivedIndex(records, expandTrigrams),
    'suffix-terms': measureDerivedIndex(records, expandSuffixes),
  };
}

/**
 * @param {import('./lib/record.mjs').CanonicalRecord[]} records
 * @param {(t:string) => string[]} expand
 */
function measureDerivedIndex(records, expand) {
  /** @type {Map<string, Set<number>>} */
  const index = new Map();
  records.forEach((r, doc) => {
    const source = [r.name, r.brand ?? '', ...r.aliases].join(' ');
    for (const token of tokenise(source)) {
      for (const key of expand(token)) {
        let set = index.get(key);
        if (!set) index.set(key, (set = new Set()));
        set.add(doc);
      }
    }
  });

  const w = new ByteWriter(1 << 16);
  for (const [key, docs] of [...index.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    w.str(key);
    const sorted = [...docs].sort((a, b) => a - b);
    w.varint(sorted.length);
    let prev = 0;
    for (const d of sorted) {
      w.varint(d - prev);
      prev = d;
    }
  }
  const body = w.finish();
  return { terms: index.size, gzip: gzipSync(body, GZ).length, dictRaw: body.length };
}

/** @param {string} t */
function expandTrigrams(t) {
  const padded = `  ${t} `;
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i + 3 <= padded.length; i++) out.push(padded.slice(i, i + 3));
  return out;
}

/** @param {string} t */
function expandSuffixes(t) {
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i));
  return out;
}

/**
 * Measure at several corpus sizes so the marginal cost can be separated from
 * the fixed overhead.
 *
 * Measured PER SHARD. Slicing the combined, rank-ordered list produces a
 * nonsense fit: the head is short generic USDA names with no barcodes and the
 * tail is long branded OFF names with barcodes, so growing the slice changes
 * the composition as well as the size, and the regression reads that as
 * superlinear growth. Each shard is internally homogeneous.
 *
 * @param {import('./lib/record.mjs').CanonicalRecord[]} records
 */
function scaling(records) {
  const points = [];
  for (const frac of [0.125, 0.25, 0.5, 1]) {
    const n = Math.max(1, Math.floor(records.length * frac));
    const subset = records.slice(0, n);
    const gzip =
      gzipSync(encodeRecords(subset, SHARD.CORE), GZ).length +
      gzipSync(encodeSearch(subset, SHARD.CORE), GZ).length +
      gzipSync(encodeBarcodes(subset, SHARD.CORE), GZ).length;
    points.push({ n, gzip, perRecord: +(gzip / n).toFixed(2) });
  }
  return points;
}

/**
 * Least-squares fit of gzip = fixed + marginal * n, then solve for the budget.
 *
 * Two caveats, stated because they bound how much weight the number carries:
 *  - The fit comes from a few hundred records. Real corpora are more repetitive
 *    (brands and category words recur), so marginal cost falls with scale and
 *    this projection is a LOWER bound on the record count.
 *  - The projection assumes the tail is as compressible as the head. Ranking
 *    puts short generic names first, so later records are slightly larger.
 *
 * @param {Array<{n:number, gzip:number}>} points @param {number} budgetBytes
 */
function project(points, budgetBytes) {
  // Distinct sizes are what make the slope identifiable. A shard with one or
  // two records yields identical points and a divide-by-zero, so say "not
  // enough data" rather than printing a NaN that looks like a measurement.
  const distinct = new Set(points.map((p) => p.n)).size;
  if (distinct < 2) {
    return {
      fixedBytes: null,
      marginalBytesPerRecord: null,
      budgetBytes,
      recordsAtBudget: 0,
      caveat: 'too few records in this shard to fit a slope',
    };
  }
  const k = points.length;
  const sx = points.reduce((s, p) => s + p.n, 0);
  const sy = points.reduce((s, p) => s + p.gzip, 0);
  const sxx = points.reduce((s, p) => s + p.n * p.n, 0);
  const sxy = points.reduce((s, p) => s + p.n * p.gzip, 0);
  const marginal = (k * sxy - sx * sy) / (k * sxx - sx * sx);
  const fixed = (sy - marginal * sx) / k;
  return {
    fixedBytes: Math.round(fixed),
    marginalBytesPerRecord: +marginal.toFixed(2),
    budgetBytes,
    recordsAtBudget: Math.floor((budgetBytes - fixed) / marginal),
    caveat:
      'lower bound: marginal cost falls as the corpus grows more repetitive, ' +
      'and this fit is over a few hundred records',
  };
}

/** @param {any} r */
function print(r) {
  console.log(`sample: ${r.sample.total} records (core ${r.sample.core}, off ${r.sample.off})\n`);

  console.log('section breakdown (gzipped, measured section-wise)');
  const rows = Object.entries(r.sections.sections).sort(
    ([, a], [, b]) => /** @type {any} */ (b).gzip - /** @type {any} */ (a).gzip,
  );
  for (const [name, v] of rows) {
    const s = /** @type {any} */ (v);
    console.log(
      `  ${name.padEnd(28)} ${String(s.gzip).padStart(8)} B gz  ` +
        `(${String(s.raw).padStart(9)} B raw, ${(s.gzip / s.raw).toFixed(2)}x)`,
    );
  }
  console.log(`  ${'TOTAL'.padEnd(28)} ${String(r.sections.totalGzip).padStart(8)} B gz\n`);

  console.log('search index structures, same tokens');
  const base = r.structures['inverted-frontcoded'];
  for (const [name, v] of Object.entries(r.structures)) {
    const s = /** @type {any} */ (v);
    console.log(
      `  ${name.padEnd(22)} ${String(s.terms).padStart(7)} keys  ` +
        `${String(s.gzip).padStart(9)} B gz (${(s.gzip / base.gzip).toFixed(2)}x)  ` +
        `${String(s.dictRaw).padStart(9)} B dict in memory (${(s.dictRaw / base.dictRaw).toFixed(2)}x)`,
    );
  }

  for (const shard of ['core', 'off']) {
    console.log(`\nscaling — ${shard} shard`);
    for (const p of r.scaling[shard]) {
      console.log(
        `  n=${String(p.n).padStart(6)}  ${String(p.gzip).padStart(9)} B gz  ${p.perRecord} B/record`,
      );
    }
    const pr = r.projection[shard];
    if (pr.marginalBytesPerRecord == null) {
      console.log(`  ${pr.caveat}`);
      continue;
    }
    console.log(
      `  fixed ${pr.fixedBytes} B, marginal ${pr.marginalBytesPerRecord} B/record ` +
        `-> ~${pr.recordsAtBudget.toLocaleString('en-US')} records in ` +
        `${(pr.budgetBytes / 1024 / 1024).toFixed(2)} MB`,
    );
  }
  console.log(
    `\nprojection: ~${r.projection.totalRecordsAtBudget.toLocaleString('en-US')} foods in ` +
      `${(budget / 1024 / 1024).toFixed(0)} MB gzipped`,
  );
  console.log(`  (${r.projection.core.caveat})`);
}

/** @param {number} kind */
function sectionName(kind) {
  return Object.entries(SECTION).find(([, v]) => v === kind)?.[0] ?? `section-${kind}`;
}

/** @param {string} path */
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return [];
  }
}

/** @param {string} name @param {string} fallback */
function flag(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? /** @type {string} */ (argv[i + 1]) : fallback;
}
