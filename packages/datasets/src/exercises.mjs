/**
 * Exercise catalogue reader.
 *
 * ⚠ THIS LOADS 213 KB GZIPPED / 1.66 MB PARSED. Never call it at module scope.
 *
 * The catalogue is two orders of magnitude larger than the workout feature
 * chunk it would be pulled into. It is async, and it resolves its data at call
 * time rather than through a static import, so a bundler cannot pull the
 * artefact into an eager chunk however this module is imported. Keeping it out
 * of the initial payload is still the caller's job:
 *
 *   // do this — the whole module and its data load on first picker open
 *   const { openExerciseCatalogue } = await import('@freeforever/datasets/exercises');
 *   const catalogue = await openExerciseCatalogue({ url: '/data/exercises.json.gz' });
 *
 *   // not this — pulls the reader into the eager graph
 *   import { openExerciseCatalogue } from '@freeforever/datasets';
 *
 * Ship a small synchronous starter set and lazy-load these 873 behind it.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { gunzip } from './gunzip.mjs';
import { fold, tokenise } from './text.mjs';

/**
 * Size of the packaged artefact, for callers deciding whether to lazy-load.
 *
 * Hand-maintained, and pinned by a test against the real artefact so it cannot
 * quietly rot into a number nobody can trust. If that test fails, the catalogue
 * grew — update these AND re-read whether the lazy-load guidance still holds.
 */
export const CATALOGUE_SIZE = {
  gzipBytes: 216730,
  parsedBytes: 1_697_000,
  exercises: 873,
};

/**
 * Load the exercise catalogue.
 *
 * Exactly one source is used, in this order of preference:
 *   - `bytes`  — an already-fetched body, gzipped or not. Works everywhere.
 *   - `url`    — fetched and decompressed. Works everywhere `fetch` does.
 *   - neither  — reads the artefact packaged with this module. **Node only**;
 *                a bundler will not include the file, so pass `url` in the app.
 *
 * @param {{bytes?:Uint8Array, url?:string, fetchImpl?:typeof fetch, signal?:AbortSignal}} [source]
 * @returns {Promise<ExerciseCatalogue>}
 */
export async function openExerciseCatalogue(source = {}) {
  const raw = await loadBytes(source);
  const json = new TextDecoder().decode(await gunzip(raw));
  /** @type {any} */
  const data = JSON.parse(json);
  return new ExerciseCatalogue(data);
}

/** @param {{bytes?:Uint8Array, url?:string, fetchImpl?:typeof fetch, signal?:AbortSignal}} source */
async function loadBytes({ bytes, url, fetchImpl, signal }) {
  if (bytes) return bytes;

  if (url) {
    const f = fetchImpl ?? fetch;
    const res = await f(url, signal ? { signal } : {});
    if (!res.ok) throw new Error(`exercise catalogue fetch failed: ${res.status} ${url}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  // Packaged fallback. The dynamic specifier keeps `node:fs` out of a browser
  // bundle: bundlers do not follow it, and it is only reached when no url or
  // bytes were supplied, which is the Node/CI path.
  if (typeof process === 'undefined' || !process.versions?.node) {
    throw new Error(
      'openExerciseCatalogue() needs `url` or `bytes` outside Node — the packaged ' +
        'artefact is not reachable from a browser bundle. See docs/food-index-format.md.',
    );
  }
  const { readFile } = await import('node:fs/promises');
  return new Uint8Array(await readFile(new URL('../build/exercises.json.gz', import.meta.url)));
}

/**
 * 873 exercises, queried by linear scan.
 *
 * No index, deliberately: a scan over 873 folded names is well under a
 * millisecond, and the food index's machinery would be more code, more schema
 * and more ways to be wrong in exchange for microseconds. Search terms are
 * folded once on construction and cached.
 */
export class ExerciseCatalogue {
  /** @param {any} data the parsed `exercises.json` document */
  constructor(data) {
    if (!data || !Array.isArray(data.exercises)) {
      throw new Error('not an exercise catalogue document');
    }
    /** @type {number} */
    this.schemaVersion = data.schemaVersion;
    /** @type {string} */
    this.builtAt = data.builtAt;
    /** @type {import('./index.d.ts').Exercise[]} */
    this.exercises = data.exercises;
    /** Every muscle name that can appear, so a consumer can assert its map is complete. */
    this.muscles = data.muscles ?? [];
    /** Every equipment name that can appear. Same purpose. */
    this.equipment = data.equipment ?? [];
    /** Rolls specific heads up to their group, e.g. `front-delts` -> `shoulders`. */
    this.muscleGroups = data.muscleGroups ?? {};
    this.source = data.source;
    this.coaching = data.coaching;

    /** @type {Map<string, any>} */
    this.#byId = new Map(this.exercises.map((e) => [e.id, e]));
    this.#terms = this.exercises.map((e) =>
      new Set([...tokenise(e.name), ...e.aliases.flatMap((a) => tokenise(a))]),
    );
    // Name term count, kept separately from the alias-inflated term set: it is
    // the denominator for the specificity bonus in search().
    this.#nameTermCount = this.exercises.map((e) => Math.max(1, tokenise(e.name).length));
    this.#foldedNames = this.exercises.map((e) => fold(e.name));
  }

  /** @type {Map<string, any>} */ #byId;
  /** @type {Array<Set<string>>} */ #terms;
  /** @type {number[]} */ #nameTermCount;
  /** @type {string[]} */ #foldedNames;

  get length() {
    return this.exercises.length;
  }

  /** @param {string} id */
  get(id) {
    return this.#byId.get(id) ?? null;
  }

  /** Every exercise, in name order. Do not mutate. */
  all() {
    return this.exercises;
  }

  /**
   * Prefix-aware, multi-token search over names and aliases, matching the food
   * index's behaviour so the two search boxes feel the same: tokens are ANDed
   * and the last token is treated as a prefix.
   * @param {string} query
   * @param {{limit?:number}} [opts]
   */
  search(query, { limit = 20 } = {}) {
    const tokens = tokenise(query);
    if (tokens.length === 0) return [];

    /** @type {Array<{exercise:any, score:number}>} */
    const hits = [];
    for (let i = 0; i < this.exercises.length; i++) {
      const terms = /** @type {Set<string>} */ (this.#terms[i]);
      let score = 0;
      let matchedAll = true;
      for (let t = 0; t < tokens.length; t++) {
        const token = /** @type {string} */ (tokens[t]);
        const last = t === tokens.length - 1;
        let best = 0;
        for (const term of terms) {
          if (term === token) best = Math.max(best, 1);
          else if (last && term.startsWith(token)) best = Math.max(best, token.length / term.length);
        }
        if (best === 0) {
          matchedAll = false;
          break;
        }
        score += best;
      }
      if (!matchedAll) continue;

      // Specificity: "barbell squat" should return "Barbell Squat" above
      // "Barbell Full Squat". Both match every token, so without this they tie
      // and fall through to an alphabetical tie-break that puts the longer,
      // more specific variant first — which is the wrong answer to a query that
      // named an exercise exactly.
      score += tokens.length / /** @type {number} */ (this.#nameTermCount[i]);
      if (this.#foldedNames[i] === fold(query)) score += 2;

      hits.push({ exercise: this.exercises[i], score });
    }

    return hits
      .sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name))
      .slice(0, limit);
  }

  /**
   * @param {{muscle?:string, equipment?:string, category?:string, mechanic?:string}} where
   *        `muscle` matches a primary or secondary entry, and also matches a
   *        group name — `shoulders` finds `front-delts` too.
   */
  filter(where = {}) {
    const wanted = where.muscle ? this.#expandMuscle(where.muscle) : null;
    return this.exercises.filter((e) => {
      if (wanted && ![...e.primaryMuscles, ...e.secondaryMuscles].some((m) => wanted.has(m))) {
        return false;
      }
      if (where.equipment && e.equipment !== where.equipment) return false;
      if (where.category && e.category !== where.category) return false;
      if (where.mechanic && e.mechanic !== where.mechanic) return false;
      return true;
    });
  }

  /** @param {string} muscle */
  #expandMuscle(muscle) {
    const m = fold(muscle).replace(/\s+/g, '-');
    const set = new Set([m]);
    for (const [specific, group] of Object.entries(this.muscleGroups)) {
      if (group === m) set.add(specific);
    }
    return set;
  }

  /**
   * Names in the catalogue that a consumer's map does not cover.
   *
   * Point your muscle enum at this and assert it is empty. The day
   * free-exercise-db is rebuilt with a new muscle name, that assertion fails
   * instead of the app silently shipping an empty muscle split.
   * @param {Iterable<string>} known
   */
  unmappedMuscleNames(known) {
    const have = new Set(known);
    return this.muscles.filter((m) => !have.has(m)).sort();
  }

  /** @param {Iterable<string>} known */
  unmappedEquipmentNames(known) {
    const have = new Set(known);
    return this.equipment.filter((e) => !have.has(e)).sort();
  }
}
