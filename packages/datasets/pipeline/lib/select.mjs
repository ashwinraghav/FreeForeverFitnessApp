/**
 * Selection — which of ~5,000,000 upstream records earn a place in 4 MB.
 *
 * At ~53 gzipped bytes per record the budget holds roughly 79,000 foods. USDA
 * Branded alone is 1.4M and Open Food Facts is 3.7M, so this stage discards
 * more than 98% of what it is handed. Ranking (`lib/rank.mjs`) orders what
 * survives; this file decides what is allowed to be ordered at all.
 *
 * The organising question is not "is this a real food?" — nearly all of them
 * are — but "can a user log a meal from this record?" A row that cannot answer
 * "one serving = what?" costs the same bytes as one that can and delivers a
 * search hit the user then abandons. Existence is not the bar. Loggability is.
 *
 * TWO POPULATIONS, TWO RULES. Applying one rule to both is the mistake:
 *
 *   Branded packaged goods — a tub of whey, a tin of beans. The manufacturer
 *     printed a serving on the label. If our copy of that record has lost it,
 *     the record is defective, and a defective copy of a product that a
 *     hundred better copies exist for is not worth 53 bytes. Serving data is
 *     therefore an ENTRY REQUIREMENT, not a ranking bonus.
 *
 *   Ingredients — raw chicken, rolled oats, a banana. Nobody prints a serving
 *     on a chicken breast; per 100 g IS the natural basis and a kitchen scale
 *     is the natural instrument. Excluding these for want of a serving label
 *     would empty the index of exactly the foods people search for most.
 *     Household measures, where USDA lists them, are a bonus.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { SOURCE } from '../../src/schema.mjs';
import { tokenise } from '../../src/text.mjs';

/**
 * How far a record's own two statements of itself may disagree before we call
 * it corrupt.
 *
 * The check is `per100 × servingGrams/100 ≈ perServing`, and the two sides come
 * from different places: the per-100 g column from one upstream field, the
 * per-serving column from the printed panel. When they disagree by a factor
 * rather than a rounding, one of them is on the wrong basis — almost always a
 * per-serving figure typed into a per-100 g field, which is the 3x error the
 * whey products are full of.
 *
 * WHY THESE NUMBERS. Two sources of honest disagreement have to survive:
 *
 *  - Label rounding. FDA rounds calories to the nearest 5 below 50 and the
 *    nearest 10 above. On a 120 kcal serving that is ±4%; on a 15 kcal serving
 *    it is ±33%. A pure percentage tolerance therefore either lets 3x errors
 *    through on small servings or rejects every correctly-labelled small one.
 *    Hence a floor in absolute kcal alongside the ratio.
 *  - Serving-size rounding. "1 scoop (31 g)" is itself rounded; a 30.5 g scoop
 *    reported as 31 g moves the expectation by 2%.
 *
 * 25% and 12 kcal clear both with room to spare, and are nowhere near the 2x
 * and 3x basis errors this exists to catch. The gap between "the worst honest
 * disagreement" (~35% on a 15 kcal serving) and "the smallest dishonest one"
 * (100%) is wide, which is what makes the rule safe to make an exclusion.
 */
export const CONSISTENCY = {
  ratioTolerance: 0.25,
  absToleranceKcal: 12,
  /** Below this, label rounding dominates entirely and the check says nothing. */
  minCheckableKcal: 5,
};

/** A serving label has to name a thing, not restate the mass. */
const MASS_ONLY = /^[\d\s.,/]*\s*(g|gram|grams|gr|ml|milliliter|millilitre|l|kg|oz|ounce|ounces|lb|fl\.?\s?oz|cc)\.?$/i;

/**
 * Is this record a branded packaged good, or an ingredient?
 *
 * Source is the reliable signal and the field values are the fallback: USDA
 * Foundation and SR Legacy are laboratory analyses of ingredients by
 * construction, USDA Branded and OFF are label transcriptions of packaged
 * goods by construction. The handful of OFF rows for loose produce ("Bananas",
 * no brand, no barcode-bearing manufacturer) are caught by the field test.
 *
 * @param {import('./record.mjs').CanonicalRecord} r
 */
export function isPackaged(r) {
  if (r.source === SOURCE.USDA_FOUNDATION || r.source === SOURCE.USDA_SR_LEGACY) return false;
  return r.brand != null || r.gtin != null;
}

/**
 * Does the record's per-100 basis agree with its own printed panel?
 *
 * @param {import('./record.mjs').CanonicalRecord} r
 * @returns {{checkable:false} | {checkable:true, ok:boolean, expected:number, reported:number, ratio:number}}
 */
export function servingConsistency(r) {
  const reported = r.reportedPerServing?.kcal;
  if (
    r.servingGrams == null ||
    !(r.servingGrams > 0) ||
    reported == null ||
    !Number.isFinite(reported) ||
    reported < CONSISTENCY.minCheckableKcal
  ) {
    return { checkable: false };
  }
  const expected = (r.n.kcal * r.servingGrams) / 100;
  if (expected < CONSISTENCY.minCheckableKcal) {
    // Expected ~0 against a reported panel value is itself a disagreement, and
    // a large one: the per-100 column is empty or the serving is wrong.
    return {
      checkable: true,
      ok: false,
      expected,
      reported,
      ratio: reported / Math.max(expected, 0.01),
    };
  }
  const delta = Math.abs(expected - reported);
  const ok =
    delta <= CONSISTENCY.absToleranceKcal ||
    delta / Math.max(expected, reported) <= CONSISTENCY.ratioTolerance;
  return { checkable: true, ok, expected, reported, ratio: reported / expected };
}

/**
 * Nutrition coverage in [0,1] — how much of the panel this record actually
 * carries. Used to pick the survivor when several copies of one product
 * compete, which on OFF is the normal case rather than the exception.
 * @param {import('./record.mjs').CanonicalRecord} r
 */
export function nutritionCoverage(r) {
  const has = [
    r.n.kcal > 0,
    r.n.proteinG > 0,
    r.n.carbG > 0,
    r.n.fatG > 0,
    r.n.fibreG > 0,
    r.n.sugarG > 0,
    r.n.sodiumMg > 0,
    r.n.satFatG > 0,
  ].filter(Boolean).length;
  return has / 8;
}

/**
 * Quality of a *surviving* branded record, used only to choose between
 * duplicates of the same product. Not a search ranking — that is rank.mjs.
 * @param {import('./record.mjs').CanonicalRecord} r
 */
export function survivorScore(r) {
  return (
    0.45 * nutritionCoverage(r) +
    0.25 * (r.highConfidence ? 1 : 0) +
    0.15 * (r.servingLabel ? 1 : 0) +
    0.1 * (r.energyDerived ? 0 : 1) +
    0.05 * (r.atwaterMismatch ? 0 : 1)
  );
}

/**
 * Apply the entry rules to one record.
 *
 * Streaming rather than array-in/array-out because the full corpora are ~5.1M
 * rows and the survivors are a few percent of them; materialising the rejects
 * costs tens of gigabytes for records that are about to be discarded.
 *
 * @param {import('./record.mjs').CanonicalRecord[]} sink  survivors are pushed here
 */
export function streamingSelect(sink) {
  /** @type {SelectionStats} */
  const stats = {
    input: 0,
    packaged: 0,
    ingredient: 0,
    keptPackaged: 0,
    keptIngredient: 0,
    noServingGrams: 0,
    noServingLabel: 0,
    massOnlyLabel: 0,
    inconsistent: 0,
    consistencyChecked: 0,
    consistencyUncheckable: 0,
    unindexableName: 0,
  };

  return {
    stats,
    /** @param {import('./record.mjs').CanonicalRecord} r */
    offer(r) {
      stats.input++;

      // A record no query can reach is dead weight in the download, whatever
      // else is right about it. Names like "H-E-B", "M&m", "x" and "U" fold to
      // nothing but single characters, which the index does not store because a
      // one-letter term matches everything and costs postings.
      //
      // This is the same invariant `verify-index.mjs` asserts on the artefact.
      // It belongs here too: a check that fails the build after a 15-minute
      // ingest is worse than a rule that never emits the record.
      if (tokenise(r.name).length === 0) {
        stats.unindexableName++;
        return false;
      }

      if (!isPackaged(r)) {
        stats.ingredient++;
        stats.keptIngredient++;
        sink.push(r);
        return true;
      }
      stats.packaged++;

      if (r.servingGrams == null || !(r.servingGrams > 0)) {
        stats.noServingGrams++;
        return false;
      }
      if (!r.servingLabel) {
        stats.noServingLabel++;
        return false;
      }
      // "31 g" is a mass, not an answer to "one serving = what?". The user
      // already has the grams; what they cannot supply is that it is a scoop.
      //
      // THIS IS A PACK-SCOPED DECISION, NOT A QUALITY JUDGEMENT, and whoever
      // builds the full pack (docs/pack-layering.md, ADR-0033) should read this
      // before copying the rule across.
      //
      // These records are wanted. They carry a valid serving weight, they are
      // perfectly loggable, and the nutrition layer already renders them
      // correctly — a mass-only label collapses to "1 serving (57 g)" with the
      // mass in the user's own unit, so they need no further work to display.
      // Excluding them here is right only because the base 4 MB is a saturated,
      // pre-warmed offline cache: the budget is full, so dropping one of these
      // promotes a record that was already queued behind it, and that record has
      // a real household label precisely because a mass-only one is what
      // disqualified the record leaving. It is a swap at a fixed size, not a
      // deletion, and the swap moves toward labels that read like a thing you
      // eat.
      //
      // In the full pack there is no budget to swap against, so this rule should
      // NOT be applied there. Reach is bought with bytes; the base pack's bar is
      // not the corpus's bar.
      if (MASS_ONLY.test(r.servingLabel)) {
        stats.massOnlyLabel++;
        return false;
      }

      const c = servingConsistency(r);
      if (!c.checkable) {
        stats.consistencyUncheckable++;
      } else {
        stats.consistencyChecked++;
        if (!c.ok) {
          stats.inconsistent++;
          return false;
        }
      }

      stats.keptPackaged++;
      sink.push(r);
      return true;
    },
  };
}

/**
 * Array-in, array-out form of {@link streamingSelect}, for tests and for
 * callers small enough not to care.
 * @param {import('./record.mjs').CanonicalRecord[]} records
 * @returns {{records: import('./record.mjs').CanonicalRecord[], stats: SelectionStats}}
 */
export function select(records) {
  /** @type {import('./record.mjs').CanonicalRecord[]} */
  const out = [];
  const s = streamingSelect(out);
  for (const r of records) s.offer(r);
  return { records: out, stats: s.stats };
}

/**
 * @typedef {object} SelectionStats
 * @property {number} input
 * @property {number} packaged
 * @property {number} ingredient
 * @property {number} keptPackaged
 * @property {number} keptIngredient
 * @property {number} noServingGrams
 * @property {number} noServingLabel
 * @property {number} massOnlyLabel
 * @property {number} inconsistent
 * @property {number} consistencyChecked
 * @property {number} consistencyUncheckable
 * @property {number} unindexableName
 */
