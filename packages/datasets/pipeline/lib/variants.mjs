/**
 * Telling one product from a near-copy of the same product.
 *
 * Open Food Facts holds a dozen contributor-entered rows for a popular branded
 * product. Three of them survived selection for Optimum Nutrition's Gold
 * Standard vanilla whey, at 120, 122 and 126 kcal per scoop — the same tub,
 * transcribed three times, and three rows the user has to choose between for no
 * reason. Barcodes differ (regional SKUs), names differ by punctuation and
 * truncation, serving labels differ ("1 scoop" vs "1 portion"), macros differ by
 * label rounding. Nothing the existing GTIN or name-fingerprint dedupe keys on
 * is stable across them.
 *
 * THE ASYMMETRY THAT DESIGNS THIS FILE: a surviving duplicate costs the user one
 * unnecessary tap. A wrong merge makes them log the wrong food and never see
 * it — vanilla whey silently logged as chocolate, whey concentrate as isolate.
 * So every rule here is a *blocker*: it looks for a reason two records must stay
 * apart, and merging is what happens when no reason is found. When in doubt,
 * do not merge.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { fold, tokenise } from '../../src/text.mjs';

/**
 * Flavour heads. Presence of a flavour in one name and not the other is an
 * absolute blocker, so this list only has to contain the *head* of a flavour
 * name, not every phrasing of it: "Double Rich Chocolate", "Extreme Milk
 * Chocolate" and "Chocolate Fudge" all reduce to `chocolate`.
 *
 * DELIBERATELY ABSENT: "ice", "cream", "milk", "rich", "double", "extreme".
 * They are flavour *modifiers*, and treating them as heads is what keeps
 * "Gold Standard 100% Whey Vanilla Flavour" apart from "Gold Standard Whey
 * (Vanilla Ice Cream Flavour)" — the same product, one of them spelled out.
 * The modifier ends up in the alias list either way, so search still finds it.
 */
export const FLAVOUR_HEADS = new Set([
  'vanilla',
  'chocolate',
  'choco',
  'cocoa',
  'strawberry',
  'banana',
  'caramel',
  'toffee',
  'butterscotch',
  'coffee',
  'mocha',
  'cappuccino',
  'latte',
  'espresso',
  'matcha',
  'cookies',
  'cookie',
  'biscuit',
  'brownie',
  'fudge',
  'tiramisu',
  'cheesecake',
  'mint',
  'peppermint',
  'coconut',
  'peanut',
  'almond',
  'hazelnut',
  'pistachio',
  'cashew',
  'walnut',
  'mango',
  'orange',
  'lemon',
  'lime',
  'berry',
  'raspberry',
  'blueberry',
  'blackberry',
  'cranberry',
  'apple',
  'cherry',
  'peach',
  'apricot',
  'pineapple',
  'grape',
  'watermelon',
  'melon',
  'passionfruit',
  'lychee',
  'guava',
  'pomegranate',
  'papaya',
  'cinnamon',
  'honey',
  'maple',
  'ginger',
  'cardamom',
  'elaichi',
  'kesar',
  'saffron',
  'badam',
  'gulab',
  'rose',
  'paan',
  'kulfi',
  'thandai',
  'jaggery',
  'masala',
  'chai',
  'unflavoured',
  'unflavored',
  'salted',
  'birthday',
  'cake',
  'marshmallow',
  'nougat',
  'pretzel',
  'sesame',
  'chilli',
  'chili',
  'pepper',
  'barbecue',
  'bbq',
  'cheese',
  'onion',
  'garlic',
  'tomato',
  'tandoori',
  'peri',
]);

/**
 * Form and formulation words. Whey concentrate and whey isolate are different
 * products at similar macros; "zero" and "light" are different products at very
 * different macros but the tolerance should never be the only thing keeping
 * them apart.
 */
export const VARIANT_HEADS = new Set([
  'isolate',
  'concentrate',
  'hydrolysed',
  'hydrolyzed',
  'hydro',
  'casein',
  'micellar',
  'whey',
  'soy',
  'pea',
  'plant',
  'vegan',
  'collagen',
  'creatine',
  'bcaa',
  'eaa',
  'glutamine',
  'gainer',
  'mass',
  'clear',
  'bar',
  'shake',
  'drink',
  'crisp',
  'wafer',
  'zero',
  'diet',
  'light',
  'lite',
  'max',
  'plus',
  'pro',
  'extra',
  'double',
  'triple',
  'mini',
  'organic',
  'decaf',
  'decaffeinated',
  'caffeine',
  'sugarfree',
  'unsweetened',
  'sweetened',
  'skimmed',
  'skim',
  'semi',
  'wholemeal',
  'wholegrain',
  'wholewheat',
  'gluten',
  'lactose',
  'preworkout',
  'postworkout',
  'instant',
  'roasted',
  'raw',
  'fried',
  'baked',
  'grilled',
  'smoked',
  'frozen',
  'dried',
  'fresh',
  'cooked',
  'boiled',
]);

/**
 * Words that carry no product identity: packaging, marketing, and units. These
 * are stripped before the name-containment test so that "Gold Standard 100%
 * Whey Vanilla Flavour" and "Gold Standard Whey (Vanilla Ice Cream Flavour)"
 * compare as the same identity rather than as two names that merely overlap.
 */
const NOISE = new Set([
  'protein',
  'powder',
  'flavour',
  'flavours',
  'flavor',
  'flavors',
  'flavoured',
  'flavored',
  'new',
  'value',
  'pack',
  'packet',
  'sachet',
  'bottle',
  'can',
  'tin',
  'tub',
  'jar',
  'box',
  'bag',
  'carton',
  'family',
  'size',
  'net',
  'wt',
  'weight',
  'g',
  'kg',
  'mg',
  'ml',
  'l',
  'oz',
  'lb',
  'lbs',
  'x',
  'pc',
  'pcs',
  'pieces',
  'ct',
  'count',
  'servings',
  'serving',
  'portion',
  'portions',
  'scoop',
  'scoops',
  'edition',
  'limited',
  'original',
  'classic',
  'premium',
  'quality',
  'best',
  'real',
  'natural',
  'authentic',
  'imported',
  'brand',
]);

/** Purely numeric or unit-ish tokens ("100", "2kg", "500ml") carry no identity. */
const NUMERIC_ISH = /^\d+(\.\d+)?(g|kg|mg|ml|l|oz|lb|lbs|kcal|%)?$/;

/**
 * The flavour heads named in a product name, as a sorted signature.
 * @param {string} name
 * @returns {string}
 */
export function flavourSignature(name) {
  return signature(name, FLAVOUR_HEADS);
}

/**
 * The form/formulation heads named in a product name, as a sorted signature.
 * @param {string} name
 * @returns {string}
 */
export function variantSignature(name) {
  return signature(name, VARIANT_HEADS);
}

/**
 * @param {string} name @param {Set<string>} vocab
 *
 * Plurals are folded to the singular before lookup. Contributors write
 * "Strawberries & Cream" and "Strawberry Cream" for the same flavour, and a
 * vocabulary that misses the plural reads the first as unflavoured — which
 * would let it merge with something it should not.
 */
function signature(name, vocab) {
  const found = new Set();
  for (const t of tokenise(name)) {
    if (vocab.has(t)) found.add(t);
    else {
      const singular = t.replace(/ies$/, 'y').replace(/(?<=..)(es|s)$/, '');
      if (singular !== t && vocab.has(singular)) found.add(singular);
    }
  }
  return [...found].sort().join('+');
}

/**
 * The tokens that identify *which product this is*, with packaging noise,
 * numbers and units removed.
 * @param {string} name
 * @returns {Set<string>}
 */
export function identityTokens(name) {
  const out = new Set();
  for (const t of tokenise(name)) {
    if (NOISE.has(t) || NUMERIC_ISH.test(t)) continue;
    out.add(t);
  }
  return out;
}

/**
 * Words that may be the ONLY difference between two names without making them
 * different products.
 *
 * This is an allow-list, and it is an allow-list on purpose. The first version
 * of this rule accepted any containment — one name's tokens being a subset of
 * the other's — and an audit of the merges it made over the shipped OFF shard
 * showed what that costs:
 *
 *   "Potato Chips Pepperoncini"        -> "Potato Chips"
 *   "Salvado Sésamo"                   -> "Salvado Natural"
 *   "X-Large Eggs"                     -> "Cage Free Large Eggs"
 *   "Reese's PB Cups"                  -> "Reese's PB&J Cups"       (484 vs 516 kcal)
 *
 * Every one of those is a distinct product silently folded into another, and no
 * block-list can be complete: the distinguishing word is a flavour nobody
 * enumerated ("pepperoncini"), a flavour in another language ("sésamo"), or a
 * size ("X-Large"). Inverting it makes the unknown case safe — an extra token
 * nobody vouched for blocks the merge.
 *
 * What is left is the pattern the allow-list exists for: a flavour written at
 * two levels of detail. "Vanilla" and "Vanilla Ice Cream" are the same flavour
 * of the same tub, and so are "Chocolate" and "Chocolate Ice Cream".
 */
const IDENTITY_MODIFIERS = new Set(['ice', 'cream', 'creme', 'creamy', 'style', 'taste']);

/**
 * Do two product names describe the same product?
 *
 * Equal identities always. Containment ONLY when the extra tokens are all
 * identity modifiers AND both names name the same flavour explicitly — the
 * flavour head is what makes "Vanilla" and "Vanilla Ice Cream" safe to fold,
 * and its absence is what makes "Potato Chips" and "Potato Chips Pepperoncini"
 * unsafe.
 *
 * @param {Set<string>} a @param {Set<string>} b
 * @param {{flavoured:boolean}} ctx  both records name at least one flavour head
 *   (the caller has already established that their flavour signatures are equal)
 */
export function identityCompatible(a, b, ctx) {
  if (a.size === 0 || b.size === 0) return false;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (!large.has(t)) return false;
  if (small.size === large.size) return true;
  if (!ctx.flavoured) return false;
  for (const t of large) if (!small.has(t) && !IDENTITY_MODIFIERS.has(t)) return false;
  return true;
}

/**
 * Brand as a merge key. Folded, and with the corporate suffixes that
 * contributors add or omit at random removed.
 * @param {string|null|undefined} brand
 */
export function brandKey(brand) {
  if (!brand) return '';
  return fold(brand)
    .replace(/\b(ltd|limited|inc|incorporated|llc|gmbh|bv|sa|plc|co|company|corp|corporation|pvt|private|group|foods|food)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Per-field tolerances for "these two rows describe the same product".
 *
 * Each field passes on EITHER an absolute or a relative margin, because the two
 * failure modes need different shapes. Label rounding is absolute (a 5 kcal
 * rounding step is 4% of 120 kcal and 33% of 15), while genuine product
 * differences scale with the value. Fat gets the widest absolute margin: the
 * three Gold Standard rows state 2.9, 3.0 and 4.84 g per 100 g for the same
 * tub, which is a 67% relative spread on a 2 g absolute one.
 *
 * Sodium and sugar are deliberately NOT tested. The same three rows state 323,
 * 329 and 419 mg of sodium — a 30% spread on a field contributors routinely
 * misread off the panel — so requiring agreement there would keep every
 * duplicate and requiring it loosely would say nothing.
 */
export const MERGE_TOLERANCE = {
  kcal: { abs: 15, rel: 0.08 },
  proteinG: { abs: 2, rel: 0.1 },
  carbG: { abs: 2, rel: 0.1 },
  fatG: { abs: 2, rel: 0.2 },
};

/**
 * Do two records' per-100 macro vectors agree closely enough to be the same
 * product?
 * @param {import('./record.mjs').CanonicalRecord} a
 * @param {import('./record.mjs').CanonicalRecord} b
 */
export function macrosAgree(a, b) {
  for (const [key, tol] of Object.entries(MERGE_TOLERANCE)) {
    const x = a.n[/** @type {keyof typeof a.n} */ (key)];
    const y = b.n[/** @type {keyof typeof b.n} */ (key)];
    const delta = Math.abs(x - y);
    if (delta <= tol.abs) continue;
    if (delta / Math.max(x, y, 1) <= tol.rel) continue;
    return false;
  }
  return true;
}

/** Serving labels that name a physical thing the user can count. */
const CONCRETE_UNIT =
  /\b(scoop|slice|bar|biscuit|cookie|cup|tbsp|tablespoon|tsp|teaspoon|piece|pc|bottle|can|glass|packet|sachet|carton|container|egg|fruit|banana|apple|square|stick|wrap|roti|chapati|idli|dosa|samosa|ladoo|capsule|tablet|sheet|slab|cube|ball|patty|link|fillet|breast|thigh|drumstick|wing)\b/i;
/** Labels that restate "one serving" without saying what a serving is. */
const GENERIC_UNIT = /\b(serving|portion|unit|helping|amount|measure)\b/i;

/**
 * Pick which of several rows for one product the user should see.
 *
 * The criteria are the ones a person would use looking at the rows side by
 * side: does the serving label tell me what to count, is the name written like
 * a product name rather than a paste from a spreadsheet, and is the nutrition
 * panel filled in. Energy is NOT a criterion — when three rows disagree by 5%
 * there is no way to tell which is right, and picking the middle one would be
 * false precision.
 *
 * @param {import('./record.mjs').CanonicalRecord} r
 */
export function representativeScore(r) {
  return (
    0.35 * servingLabelQuality(r.servingLabel) +
    0.3 * nameCleanliness(r.name) +
    0.25 * panelCoverage(r) +
    0.1 * (r.highConfidence ? 1 : 0)
  );
}

/** @param {string|null} label */
function servingLabelQuality(label) {
  if (!label) return 0;
  if (CONCRETE_UNIT.test(label)) return 1;
  if (GENERIC_UNIT.test(label)) return 0.4;
  return 0.7;
}

/**
 * Is this written like a product name? Contributor rows arrive SHOUTED, all
 * lowercase, truncated mid-word, or with the punctuation of a bad paste.
 * @param {string} name
 */
function nameCleanliness(name) {
  let s = 1;
  const letters = name.replace(/[^\p{L}]/gu, '');
  if (letters && letters === letters.toLowerCase()) s -= 0.35;
  if (letters && letters === letters.toUpperCase()) s -= 0.25;
  if (/[-,;:(]\s*$/.test(name.trim())) s -= 0.3; // truncated mid-clause
  if (/\S-\s/.test(name)) s -= 0.15; // "protein- vanilla"
  if (/\s{2,}/.test(name)) s -= 0.1;
  if (name.length > 70) s -= 0.15;
  return Math.max(0, s);
}

/** @param {import('./record.mjs').CanonicalRecord} r */
function panelCoverage(r) {
  const filled = [
    r.n.kcal > 0,
    r.n.proteinG > 0,
    r.n.carbG > 0,
    r.n.fatG > 0,
    r.n.fibreG > 0,
    r.n.sugarG > 0,
    r.n.sodiumMg > 0,
    r.n.satFatG > 0,
  ].filter(Boolean).length;
  return filled / 8;
}
