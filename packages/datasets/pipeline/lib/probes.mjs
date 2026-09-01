/**
 * Acceptance probes — named foods that must be findable in a shipped index.
 *
 * These are not fixture tests. They run against the emitted artefact, by
 * searching it the way the app does, and they exist because the failure this
 * pipeline actually had was not a bug in any function: every unit test passed
 * while the shipped index held 784 sample records and no serving labels. A
 * green suite could not see it. A probe that types "gold standard whey vanilla"
 * into the real index can.
 *
 * Each probe is a claim about the corpus that a rebuild can falsify. If a
 * re-ranked build drops one of these, or ranks a duplicate above it, the build
 * fails — which is what makes the index falsifiable rather than hopeful.
 *
 * A probe is expensive to add casually and cheap to keep, so prefer few and
 * specific: one per shape of failure we have actually seen or been told about.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @typedef {object} Probe
 * @property {string}  id
 * @property {string}  why           what this probe is defending, in one line
 * @property {'core'|'off'} shard
 * @property {string}  query         typed exactly as a user would
 * @property {number}  [withinTop]   the expected record must appear this high (default 3)
 * @property {RegExp}  [brand]
 * @property {RegExp}  name
 * @property {RegExp}  [servingLabel]
 * @property {[number, number]} [servingGrams]
 * @property {[number, number]} [kcalPerServing]
 * @property {[number, number]} [kcalPer100]   per-100 g band; prefer this over
 *   kcalPerServing for a generic ingredient, whose serving size is whatever
 *   household measure USDA happened to list and so is not a stable assertion
 * @property {[number, number]} [proteinPerServing]
 * @property {boolean} [brandless]  the match must be a generic, not a branded row
 * @property {number}  [maxMatches]  how many hits may match `name` at all —
 *   1 asserts the duplicates really were collapsed
 */

/** @type {Probe[]} */
export const PROBES = [
  {
    id: 'gold-standard-whey-vanilla',
    why: 'The user\'s acceptance test. One row, one scoop, ~120 kcal, ~24 g protein.',
    shard: 'off',
    query: 'gold standard whey vanilla',
    withinTop: 3,
    brand: /optimum nutrition/i,
    name: /gold standard.*whey/i,
    servingLabel: /scoop/i,
    servingGrams: [28, 34],
    kcalPerServing: [110, 130],
    proteinPerServing: [22, 26],
    // The whole point of the cluster dedupe: three transcriptions of this tub
    // survived selection, and the user should be shown one.
    maxMatches: 1,
  },
  {
    id: 'chicken-breast-raw',
    why: 'The most-logged ingredient there is. Must resolve to a generic, not a branded deli roll.',
    shard: 'core',
    query: 'chicken breast',
    withinTop: 25,
    // Deliberately narrow. `/chicken.*breast/` also matches "Chicken breast
    // tenders, breaded, uncooked", and a probe that passes on breaded tenders is
    // not testing what it says it tests — it went green on exactly that while
    // the plain cut sat behind it.
    name: /^Chicken, (broilers?|breast)/i,
    // Per 100 g, not per serving: a generic ingredient's serving size is
    // whatever household measure USDA listed, so a per-serving band asserts the
    // portion rather than the food. An earlier version failed at 39.5 kcal for a
    // 56 g deli slice — a brittle probe, not a bad index.
    kcalPer100: [80, 250],
    brandless: true,
  },
  {
    id: 'rolled-oats',
    why: 'A dry staple weighed on a scale — the case where a household measure is a bonus, not a requirement.',
    shard: 'core',
    query: 'oats',
    withinTop: 25,
    name: /oats/i,
  },
  {
    id: 'chapati-roti',
    why: 'Locale coverage that the US-weighted build does supply, via USDA rather than OFF.',
    shard: 'core',
    query: 'chapati',
    withinTop: 10,
    name: /chapati|roti/i,
    servingLabel: /piece/i,
  },
  {
    id: 'bare-staple-noun',
    why: 'A one-word query for a raw ingredient. The plural-penalty defect buried these at rank 539.',
    shard: 'core',
    query: 'potato',
    withinTop: 6,
    name: /^Potatoes,.*raw/i,
    brandless: true,
  },
  {
    id: 'baked-beans-uk',
    why: 'A common UK/EU packaged food, to prove the OFF shard is not US-only.',
    shard: 'off',
    query: 'baked beans',
    withinTop: 25,
    name: /baked beans/i,
    servingGrams: [40, 500],
  },
  {
    id: 'coca-cola',
    why: 'A drink: the ml basis and a per-container serving rather than per 100 g.',
    shard: 'off',
    query: 'coca cola',
    withinTop: 25,
    name: /coca.?cola|coke/i,
  },
  {
    id: 'greek-yogurt',
    why: 'A high-protein staple people log by the tub, so the serving label has to be a container.',
    shard: 'off',
    query: 'greek yogurt',
    withinTop: 25,
    name: /greek/i,
  },
];

/**
 * Run the probes against open readers.
 *
 * @param {Record<string, {length:number, get(i:number):any, search(q:string, o?:any):any[]}>} indexes
 *        shard name -> reader
 * @returns {{id:string, ok:boolean, detail:string}[]}
 */
export function runProbes(indexes) {
  /** @type {{id:string, ok:boolean, detail:string}[]} */
  const results = [];

  for (const p of PROBES) {
    const idx = indexes[p.shard];
    if (!idx) {
      results.push({ id: p.id, ok: false, detail: `no ${p.shard} shard in this build` });
      continue;
    }

    const hits = idx.search(p.query, { limit: 200 });
    const matches = hits.filter((/** @type {any} */ h) => matchesIdentity(p, h.food));

    if (matches.length === 0) {
      results.push({
        id: p.id,
        ok: false,
        detail:
          `"${p.query}" returned ${hits.length} hits, none matching ${p.name}` +
          (hits.length > 0
            ? ` — top 3: ${hits
                .slice(0, 3)
                .map((/** @type {any} */ h) => JSON.stringify(h.food.name))
                .join(', ')}`
            : ''),
      });
      continue;
    }

    const rank = hits.indexOf(matches[0]) + 1;
    const withinTop = p.withinTop ?? 3;
    /** @type {string[]} */
    const problems = [];

    if (rank > withinTop) {
      problems.push(`ranked ${rank}, must be within the top ${withinTop}`);
    }
    if (p.maxMatches != null && matches.length > p.maxMatches) {
      problems.push(
        `${matches.length} rows match where ${p.maxMatches} should — ` +
          `${matches
            .slice(0, 4)
            .map((/** @type {any} */ m) => JSON.stringify(m.food.name))
            .join(', ')}`,
      );
    }

    const food = matches[0].food;
    if (p.brand && !p.brand.test(food.brand ?? '')) {
      problems.push(`brand ${JSON.stringify(food.brand)} does not match ${p.brand}`);
    }
    if (p.servingLabel && !p.servingLabel.test(food.servingLabel ?? '')) {
      problems.push(`serving label ${JSON.stringify(food.servingLabel)} does not match ${p.servingLabel}`);
    }
    if (p.servingGrams) {
      inRange(problems, 'servingGrams', food.servingGrams, p.servingGrams);
    }
    if (p.kcalPerServing) {
      inRange(problems, 'kcal/serving', perServing(food, 'kcal'), p.kcalPerServing);
    }
    if (p.kcalPer100) {
      inRange(problems, 'kcal/100g', food.per100?.kcal, p.kcalPer100);
    }
    if (p.brandless && food.brand) {
      problems.push(`resolved to a branded row (${JSON.stringify(food.brand)}), expected a generic`);
    }
    if (p.proteinPerServing) {
      inRange(problems, 'protein/serving', perServing(food, 'proteinG'), p.proteinPerServing);
    }

    results.push({
      id: p.id,
      ok: problems.length === 0,
      detail: problems.length === 0 ? describe(food, rank) : problems.join('; '),
    });
  }

  return results;
}

/** @param {Probe} p @param {any} food */
function matchesIdentity(p, food) {
  if (!p.name.test(food.name ?? '')) return false;
  if (p.brand && !p.brand.test(food.brand ?? '')) return false;
  if (p.brandless && food.brand) return false;
  return true;
}

/** @param {any} food @param {'kcal'|'proteinG'} key */
function perServing(food, key) {
  const grams = food.servingGrams;
  const per100 = food.per100?.[key];
  if (!(grams > 0) || !Number.isFinite(per100)) return null;
  return (per100 * grams) / 100;
}

/**
 * @param {string[]} problems @param {string} label
 * @param {number|null|undefined} value @param {[number, number]} range
 */
function inRange(problems, label, value, [lo, hi]) {
  if (value == null || !Number.isFinite(value)) {
    problems.push(`${label} is missing`);
  } else if (value < lo || value > hi) {
    problems.push(`${label} is ${value.toFixed(1)}, expected ${lo}–${hi}`);
  }
}

/**
 * What the probe resolved to — printed on success as well as failure, because
 * "the probe passed" is much less useful than "the probe resolved to this".
 * @param {any} food @param {number} rank
 */
export function describe(food, rank) {
  const grams = food.servingGrams;
  const parts = [];
  if (food.servingLabel && grams > 0) parts.push(`${food.servingLabel} (${round(grams)} g)`);
  else if (grams > 0) parts.push(`${round(grams)} g`);
  else parts.push('per 100 g');
  const kcal = perServing(food, 'kcal') ?? food.per100?.kcal;
  const protein = perServing(food, 'proteinG') ?? food.per100?.proteinG;
  if (Number.isFinite(kcal)) parts.push(`~${Math.round(kcal)} kcal`);
  if (Number.isFinite(protein)) parts.push(`~${round(protein)} g protein`);
  const brand = food.brand ? `${food.brand} — ` : '';
  return `#${rank} ${brand}${food.name} · ${parts.join(' · ')}`;
}

/** @param {number} v */
function round(v) {
  return Math.round(v * 10) / 10;
}
