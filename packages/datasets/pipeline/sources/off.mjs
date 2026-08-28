/**
 * Open Food Facts source adapter.
 *
 * Licence: ODbL-1.0 on the database, DbCL-1.0 on individual contents,
 * CC-BY-SA on images. See NOTICE.md §2 — that section is binding on this file.
 *
 * Three rules this adapter enforces, not by convention but in code:
 *
 *  1. It requests a field allow-list. No image field is ever requested, so no
 *     CC-BY-SA material can enter the pipeline by accident. (NOTICE.md §2.5)
 *  2. Every emitted record carries its barcode as `sourceId`. OFF's terms
 *     require re-users to credit contributors with a link to the product, and
 *     the barcode is what makes that link constructible. A record without one
 *     is dropped rather than shipped uncreditable. (NOTICE.md §2.2)
 *  3. Everything it emits is tagged SOURCE.OFF and lands only in the `off`
 *     shard. (NOTICE.md §2.4)
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { SOURCE } from '../../src/schema.mjs';
import { displayName } from '../../src/text.mjs';
import {
  EMPTY_NUTRIENTS,
  fillEnergy,
  parseServing,
  quantise,
  servingLabel,
  validate,
} from '../lib/nutrients.mjs';
import { normaliseGtin } from './usda.mjs';

const API = 'https://world.openfoodfacts.org/api/v2/search';

/**
 * Field allow-list. Adding an `image*` field here is a licence violation, not a
 * size regression — see NOTICE.md §2.5. `verify-index.mjs` re-checks the output.
 */
export const FIELDS = [
  'code',
  'product_name',
  'generic_name',
  'brands',
  'quantity',
  'serving_size',
  'serving_quantity',
  'nutriments',
  'countries_tags',
  'unique_scans_n',
  'completeness',
  'categories_tags',
  'lang',
];

/**
 * OFF asks re-users to identify themselves in the User-Agent. Doing so is both
 * good manners and the thing that keeps us off their rate limiter.
 */
export const USER_AGENT =
  'TheFreeForeverFitnessApp/0.1 (dataset build pipeline; https://github.com/thefreeforeverfitnessapp)';

/**
 * Page through the OFF search API.
 *
 * A FULL build must NOT use this endpoint — see README. It exists so the sample
 * build runs the same mapping code as the full build. The full build reads the
 * published JSONL/MongoDB dump, which is one file transfer instead of a hundred
 * thousand API calls against a charity's servers.
 *
 * @param {{pages?:number, pageSize?:number, sortBy?:string, country?:string, fetchImpl?:typeof fetch}} opts
 */
export async function* fetchSearch({
  pages = 1,
  pageSize = 100,
  sortBy = 'unique_scans_n',
  country = 'united-states',
  fetchImpl = fetch,
} = {}) {
  for (let page = 1; page <= pages; page++) {
    const url =
      `${API}?countries_tags_en=${encodeURIComponent(country)}` +
      `&fields=${FIELDS.join(',')}&page_size=${pageSize}&page=${page}&sort_by=${sortBy}`;
    const res = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`OFF ${res.status} ${res.statusText} on page ${page}`);
    const body = await res.json();
    const products = body?.products ?? [];
    if (products.length === 0) return;
    for (const p of products) yield p;
    if (products.length < pageSize) return;
  }
}

/**
 * The published bulk dump. This is what a FULL build reads: one 12.7 GB
 * transfer instead of a million API calls.
 */
export const DUMP_URL = 'https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz';

/**
 * Stream products from the JSONL dump, optionally reading only a byte prefix.
 *
 * The prefix trick is what lets the sample build use the *same* code path as
 * the full build: the dump is gzip, gzip decodes as a stream, and a truncated
 * stream yields whole lines until it runs out. A sample that exercises a
 * different reader than production is a sample that proves nothing.
 *
 * @param {{byteLimit?:number|null, maxProducts?:number, url?:string, fetchImpl?:typeof fetch}} opts
 * @returns {AsyncGenerator<any>}
 */
export async function* fetchDump({
  byteLimit = null,
  maxProducts = Infinity,
  url = DUMP_URL,
  fetchImpl = fetch,
} = {}) {
  const { createGunzip } = await import('node:zlib');
  const { Readable } = await import('node:stream');

  /** @type {Record<string,string>} */
  const headers = { 'user-agent': USER_AGENT };
  if (byteLimit != null) headers.range = `bytes=0-${byteLimit - 1}`;

  const res = await fetchImpl(url, { headers });
  if (!res.ok && res.status !== 206) throw new Error(`OFF dump ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error('OFF dump returned no body');

  const gunzip = createGunzip();
  // A truncated gzip stream ends in an error by definition. That is expected on
  // the prefix path and must not fail the build.
  gunzip.on('error', () => {});
  Readable.fromWeb(/** @type {any} */ (res.body)).pipe(gunzip);

  let buf = '';
  let emitted = 0;
  for await (const chunk of gunzip) {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let product;
      try {
        product = JSON.parse(line);
      } catch {
        continue; // a truncated final line; skip it
      }
      yield project(product);
      if (++emitted >= maxProducts) return;
    }
  }
}

/**
 * Reduce a dump row to the allow-listed fields, immediately on read.
 *
 * Dump rows carry ~190 fields including every image reference. Projecting here
 * rather than downstream means no image URL is ever held in memory, written to
 * a fixture, or accidentally serialised — the CC-BY-SA material is dropped at
 * the boundary. (NOTICE.md §2.5)
 * @param {any} p
 */
function project(p) {
  /** @type {any} */
  const out = {};
  for (const f of FIELDS) if (p[f] !== undefined) out[f] = p[f];
  return out;
}

/**
 * Map one OFF product to a canonical record, or null if unusable.
 * @param {any} p
 * @returns {import('../lib/record.mjs').CanonicalRecord | null}
 */
export function mapProduct(p) {
  // Rule 2: no barcode, no record. See the file header.
  const gtin = normaliseGtin(p?.code);
  if (gtin == null) return null;

  const raw = String(p.product_name ?? p.generic_name ?? '').trim();
  if (!raw || raw.length > 120) return null;

  const nm = p.nutriments ?? {};
  const energyReported =
    num(nm['energy-kcal_100g']) != null ||
    num(nm['energy-kj_100g']) != null ||
    num(nm.energy_100g) != null;
  // Always the _100g variant. `nutriments.protein` without a suffix is
  // whatever unit the contributor typed and cannot be trusted.
  const kcal = num(nm['energy-kcal_100g']) ?? kjToKcal(num(nm['energy-kj_100g']) ?? num(nm.energy_100g));
  const n = {
    ...EMPTY_NUTRIENTS,
    kcal: kcal ?? 0,
    proteinG: num(nm.proteins_100g) ?? 0,
    carbG: num(nm.carbohydrates_100g) ?? 0,
    fatG: num(nm.fat_100g) ?? 0,
    fibreG: num(nm.fiber_100g) ?? 0,
    sugarG: num(nm.sugars_100g) ?? 0,
    // OFF stores sodium in GRAMS per 100 g, not milligrams. Missing this is a
    // 1000x error; it is the single most dangerous unit in either upstream.
    sodiumMg: (num(nm.sodium_100g) ?? saltToSodiumG(num(nm.salt_100g)) ?? 0) * 1000,
    satFatG: num(nm['saturated-fat_100g']) ?? 0,
  };

  const filled = fillEnergy(n);
  const check = validate(filled.n, { energyReported });
  if (!check.ok) return null;

  const serving = parseServing(num(p.serving_quantity) ?? p.serving_size);
  const basis = /** @type {'g'|'ml'} */ (
    serving?.basis === 'ml' || /\b(ml|l|cl)\b/i.test(String(p.quantity ?? '')) ? 'ml' : 'g'
  );

  const brands = String(p.brands ?? '')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);

  return {
    source: SOURCE.OFF,
    sourceId: String(p.code), // required for attribution — never drop
    name: displayName(raw),
    rawName: raw,
    brand: brands[0] ?? null,
    gtin: gtin.value,
    gtinDigits: gtin.digits,
    basis,
    n: quantise(filled.n),
    servingGrams: serving?.grams ?? null,
    servingLabel: servingLabel(p.serving_size),
    servingEstimated: serving?.estimated ?? false,
    atwaterMismatch: check.atwaterMismatch,
    energyReported,
    energyDerived: filled.derived,
    highConfidence: (num(p.completeness) ?? 0) >= 0.75,
    // Secondary brand names are searchable aliases; the generic name catches
    // "soda" for a product named "Diet Coke".
    aliases: [...brands.slice(1), String(p.generic_name ?? '').trim()].filter(
      (a) => a && a.toLowerCase() !== raw.toLowerCase(),
    ),
    popularity: num(p.unique_scans_n) ?? 0,
    countries: (p.countries_tags ?? [])
      .map((/** @type {string} */ t) => t.replace(/^en:/, ''))
      .slice(0, 8),
  };
}

/** @param {unknown} v */
function num(v) {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** @param {number|null} kj */
function kjToKcal(kj) {
  return kj == null ? null : kj / 4.184;
}

/** Salt (NaCl) to sodium, both in grams. @param {number|null} saltG */
function saltToSodiumG(saltG) {
  return saltG == null ? null : saltG / 2.5;
}

/**
 * The attribution link OFF's terms require us to render for every OFF-sourced
 * food. The app must call this rather than building the URL inline, so that a
 * change to OFF's URL scheme is a one-line fix.
 * @param {string} barcode
 */
export function productUrl(barcode) {
  return `https://world.openfoodfacts.org/product/${encodeURIComponent(barcode)}`;
}
