/**
 * GS1 prefix -> issuing region, for build reporting only.
 *
 * This is a *measurement* tool, not a ranking signal, and the distinction
 * matters. `countries_tags` says where a product is sold, which is what
 * `rank.mjs` biases on; a barcode prefix says which GS1 member organisation
 * issued the number, which is roughly where the company registered. They
 * disagree often enough that neither substitutes for the other — but the prefix
 * is the one an outside reviewer can verify from the shipped artefact alone,
 * with no upstream field to trust, which is exactly what a coverage claim needs.
 *
 * So: rank on `countries_tags`, report on prefixes. If the two ever tell
 * different stories about a build, the report is the honest one, because the
 * artefact is all a user gets.
 *
 * Ranges from the GS1 prefix list. Only the buckets we make claims about are
 * named; everything else is `other`, which is a real answer and not a gap.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/** @type {Array<[number, number, string]>} lo, hi (inclusive), label */
const RANGES = [
  [0, 139, 'us-ca'],
  [300, 379, 'fr'],
  [400, 440, 'de'],
  [450, 459, 'jp'],
  [490, 499, 'jp'],
  [460, 469, 'ru'],
  [500, 509, 'uk'],
  [539, 539, 'ie'],
  [560, 560, 'pt'],
  [570, 579, 'dk'],
  [590, 590, 'pl'],
  [600, 601, 'za'],
  [619, 619, 'tn'],
  [640, 649, 'fi'],
  [690, 699, 'cn'],
  [729, 729, 'il'],
  [730, 739, 'se'],
  [750, 750, 'mx'],
  [754, 755, 'us-ca'],
  [760, 769, 'ch'],
  [770, 771, 'co'],
  [773, 773, 'uy'],
  [775, 775, 'pe'],
  [777, 777, 'bo'],
  [778, 779, 'ar'],
  [780, 780, 'cl'],
  [784, 784, 'py'],
  [786, 786, 'ec'],
  [789, 790, 'br'],
  [800, 839, 'it'],
  [840, 849, 'es'],
  [850, 850, 'cu'],
  [858, 858, 'sk'],
  [859, 859, 'cz'],
  [860, 860, 'rs'],
  [865, 865, 'mn'],
  [867, 867, 'kp'],
  [868, 869, 'tr'],
  [870, 879, 'nl'],
  [880, 881, 'kr'],
  [883, 883, 'mm'],
  [884, 884, 'kh'],
  [885, 885, 'th'],
  [888, 888, 'sg'],
  [890, 890, 'in'],
  [893, 893, 'vn'],
  [896, 896, 'pk'],
  [899, 899, 'id'],
  [900, 919, 'at'],
  [930, 939, 'au'],
  [940, 949, 'nz'],
  [955, 955, 'my'],
  [958, 958, 'mo'],
];

/**
 * Which GS1 member organisation issued this barcode.
 *
 * A GTIN-8 (`ean8`) has no member-organisation prefix in the same position and
 * is reported as `short` rather than being silently mis-bucketed as us-ca by
 * zero-padding — that mis-bucketing is how a "40% US" figure gets inflated.
 *
 * @param {string|number|null|undefined} barcode
 * @returns {string} a region label, or 'none' / 'short'
 */
export function gs1Region(barcode) {
  if (barcode == null) return 'none';
  const digits = String(barcode).replace(/\D/g, '');
  if (digits.length === 0) return 'none';
  if (digits.length <= 8) return 'short';
  const p = Number(digits.padStart(13, '0').slice(0, 3));
  for (const [lo, hi, label] of RANGES) if (p >= lo && p <= hi) return label;
  return 'other';
}

/**
 * Count records by issuing region.
 * @param {Iterable<{gtin?:number|null, gtinDigits?:number|null}>} records
 * @returns {Record<string, number>} sorted descending by count
 */
export function regionMix(records) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const r of records) {
    const bc = r.gtin == null ? null : String(r.gtin).padStart(r.gtinDigits ?? String(r.gtin).length, '0');
    const k = gs1Region(bc);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  /** @type {Record<string, number>} */
  const out = {};
  for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) out[k] = v;
  return out;
}
