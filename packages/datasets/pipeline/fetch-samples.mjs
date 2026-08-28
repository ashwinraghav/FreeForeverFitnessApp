#!/usr/bin/env node
/**
 * Fetch a SMALL sample from each upstream into `fixtures/`, enough to exercise
 * the whole pipeline end to end.
 *
 * This is deliberately not a full build. The full USDA and Open Food Facts
 * corpora are tens of gigabytes and Open Food Facts is a charity paying for its
 * own bandwidth; hammering their search API for a million products would be
 * both slow and rude. A full build reads the published bulk dumps instead — see
 * README.md, "Running a full build".
 *
 * Usage:
 *   node pipeline/fetch-samples.mjs                # ~500 foods, ~800 exercises
 *   node pipeline/fetch-samples.mjs --off-pages 5  # more OFF products
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { USER_AGENT, fetchDump } from './sources/off.mjs';
import { fetchList } from './sources/usda.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = resolve(ROOT, 'fixtures');

const EXERCISE_SOURCE =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';

const args = parseArgs(process.argv.slice(2));

await mkdir(FIXTURES, { recursive: true });

if (!args.only || args.only === 'usda') await fetchUsda();
if (!args.only || args.only === 'off') await fetchOff();
if (!args.only || args.only === 'exercises') await fetchExercises();

async function fetchUsda() {
  // Foundation and SR Legacy are the generic whole foods that dominate real
  // searches, so a sample skewed towards them exercises the ranking code on the
  // records that matter rather than on a random slice of branded cereal.
  /** @type {any[]} */
  const out = [];
  for (const dataType of ['Foundation', 'SR Legacy', 'Branded']) {
    const pageSize = dataType === 'Branded' ? args.usdaBranded : args.usdaGeneric;
    if (pageSize === 0) continue;
    try {
      for await (const food of fetchList({ dataType, pageSize, pages: 1 })) {
        out.push({ ...food, dataType });
      }
      console.log(`[usda] ${dataType}: ${out.length} cumulative`);
    } catch (err) {
      console.error(`[usda] ${dataType} failed: ${/** @type {Error} */ (err).message}`);
      if (out.length === 0) throw err;
    }
    await sleep(1200); // DEMO_KEY is rate limited; be polite even with a real key
  }
  await write('usda-sample.json', out.map(pruneNutrients));
}

async function fetchOff() {
  // Read a byte prefix of the published dump rather than paging the search API.
  // Same code path as a full build (see off.mjs `fetchDump`), and it costs Open
  // Food Facts one ranged GET instead of hundreds of query executions.
  /** @type {any[]} */
  const out = [];
  for await (const p of fetchDump({
    byteLimit: args.offBytes,
    maxProducts: args.offProducts,
  })) {
    out.push(p);
  }
  await write('off-sample.json', out);
}

async function fetchExercises() {
  const res = await fetch(EXERCISE_SOURCE, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`free-exercise-db ${res.status}`);
  const data = await res.json();
  await write('free-exercise-db.json', data);
}

/**
 * FDC returns ~100 nutrients per food; we map eight. Keeping all of them would
 * put 3.8 MB of unused fatty-acid profiles in a public repository forever.
 *
 * A few unmapped nutrients are kept deliberately, and listed first, so the
 * fixture still exercises the "skip nutrients we don't recognise" path and
 * proves the mapping does not depend on array order.
 * @param {any} food
 */
function pruneNutrients(food) {
  const MAPPED = new Set(['208', '203', '205', '204', '291', '269', '307', '606']);
  const DECOYS = ['255', '301', '303', '318', '430'];
  const all = food.foodNutrients ?? [];
  const num = (/** @type {any} */ n) => String(n.number ?? n.nutrientNumber ?? '');
  return {
    ...food,
    foodNutrients: [
      ...all.filter((/** @type {any} */ n) => DECOYS.includes(num(n))).slice(0, 3),
      ...all.filter((/** @type {any} */ n) => MAPPED.has(num(n))),
    ],
  };
}

/** @param {string} name @param {unknown} data */
async function write(name, data) {
  const path = resolve(FIXTURES, name);
  await writeFile(path, `${JSON.stringify(data, null, 1)}\n`);
  const n = Array.isArray(data) ? data.length : 1;
  console.log(`wrote ${name} (${n} records)`);
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const get = (/** @type {string} */ flag, /** @type {number} */ fallback) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
  };
  const onlyIdx = argv.indexOf('--only');
  return {
    offBytes: get('--off-bytes', 12_000_000),
    offProducts: get('--off-products', 600),
    usdaGeneric: get('--usda-generic', 200),
    usdaBranded: get('--usda-branded', 100),
    only: onlyIdx >= 0 ? argv[onlyIdx + 1] : null,
  };
}
