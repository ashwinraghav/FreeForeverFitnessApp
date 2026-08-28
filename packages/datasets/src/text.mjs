/**
 * Text folding and tokenisation.
 *
 * CRITICAL: the build pipeline and the query path must call exactly these
 * functions. A token produced at build time that folds differently at query time
 * is silently unfindable, and that class of bug does not show up in a size
 * report. `pipeline/test/text.test.mjs` pins the behaviour.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fold to a searchable form: lowercase, strip diacritics, collapse punctuation
 * to spaces, normalise whitespace.
 *
 * Diacritics are stripped rather than preserved because the query comes from a
 * phone keyboard mid-workout. Someone looking for "crème fraîche" types "creme
 * fraiche" and must find it. The display name keeps its accents; only the index
 * term is folded.
 *
 * @param {string} s
 * @returns {string}
 */
export function fold(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '') // combining marks left behind by NFD
    .toLowerCase()
    .replace(/['’´`]/gu, '') // don't split "hershey's" into two tokens
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

/**
 * Tokens that carry no discriminating power in a food name. Removing them from
 * the index is worth roughly 4% of postings on the sample and, more importantly,
 * stops a query like "cup of tea" from intersecting on "of".
 */
const STOPWORDS = new Set([
  'and',
  'or',
  'the',
  'a',
  'an',
  'of',
  'with',
  'in',
  'on',
  'for',
  'to',
  'from',
  'by',
  'de',
  'la',
  'le',
  'el',
  'du',
  'des',
]);

/**
 * Split folded text into index terms.
 *
 * Single characters are dropped (they match everything and cost postings), with
 * the exception of digits, which are kept because they discriminate strongly in
 * product names ("2% milk", "diet 7 up").
 *
 * @param {string} s
 * @returns {string[]}
 */
export function tokenise(s) {
  const out = [];
  for (const t of fold(s).split(' ')) {
    if (!t) continue;
    if (STOPWORDS.has(t)) continue;
    if (t.length < 2 && !/^\p{N}$/u.test(t)) continue;
    out.push(t);
  }
  return out;
}

/**
 * Fingerprint used for name-based dedupe: folded tokens, deduplicated, sorted.
 * Order-insensitive so "Yogurt, Greek, Plain" and "Plain Greek Yogurt" collide.
 * @param {string} s
 */
export function fingerprint(s) {
  return [...new Set(tokenise(s))].sort().join(' ');
}

/**
 * Upstream food names are inverted-index-style ("Cheese, cheddar, sharp") or
 * SHOUTED ("KELLOGGS CORN FLAKES"). Neither reads well one-handed on a phone.
 *
 * We reorder leading comma clauses ("Cheese, cheddar" -> "Cheddar Cheese") only
 * for two-clause names, where the transformation is reliable. Longer clause
 * chains are left alone: "Beef, round, top round, separable lean only" turns
 * into nonsense if reordered, and a wrong name is worse than an awkward one.
 *
 * @param {string} raw
 * @returns {string}
 */
export function displayName(raw) {
  let s = raw.trim().replace(/\s+/gu, ' ');
  if (s === s.toUpperCase() && /[A-Z]{4,}/u.test(s)) s = titleCase(s);
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 2 && parts[1] && parts[1].split(' ').length <= 2) {
    s = `${capitalise(parts[1])} ${lowerFirstWordIfPlain(parts[0])}`;
  }
  return s.trim();
}

/** @param {string} s */
function titleCase(s) {
  return s
    .toLowerCase()
    .replace(/(^|[\s(/-])(\p{L})/gu, (_m, pre, ch) => `${pre}${ch.toUpperCase()}`);
}

/** @param {string} s */
function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Keep an existing capital (brand or proper noun); otherwise lowercase it. @param {string} s */
function lowerFirstWordIfPlain(s) {
  const [first = '', ...rest] = s.split(' ');
  const isAcronymOrBrand = first.length > 1 && first === first.toUpperCase();
  return [isAcronymOrBrand ? first : first.toLowerCase(), ...rest].join(' ');
}
