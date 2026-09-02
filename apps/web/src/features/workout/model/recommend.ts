import type { MuscleGroup } from '@freeforever/data';
import { hardSetsByMuscle } from '@freeforever/core';

import { STARTER_CATALOGUE } from '../catalogue/starter.js';
import type { CatalogueEntry } from '../catalogue/types.js';
import { toPerformedSet, type CompletedSession } from './history.js';

/**
 * What to train next, inferred from the last few sessions.
 *
 * ## The whole idea in one sentence
 *
 * Muscles you have not worked lately float to the top of the picker; muscles you
 * hammered yesterday sink. Nothing prescribes a session, nothing has to be configured,
 * and ignoring it costs a scroll.
 *
 * This is the zero-cost coaching ADR-0016 asks for: a deterministic fold over sessions
 * already on the device. No model, no network, no per-user cost (ADR-0001).
 *
 * ## Why "least trained" and not "most trained"
 *
 * A picker that surfaced what you do most would recommend bench press to somebody who
 * has benched three days running. The useful signal is the gap — a lifter who has done
 * three push sessions is a lifter who owes their back something. Recommending the gap
 * also degrades gracefully: with no history at all every muscle is equally untrained,
 * which correctly means "no opinion" rather than a confident wrong answer.
 *
 * ## Familiar lifts win ties
 *
 * Given two exercises that hit the same neglected muscle, the one already in your log
 * beats a stranger from the long tail. You know how to do it, the bar is loaded from
 * last time's ghost, and the progression engine has history to work from. The 830
 * dataset entries are there to be *found*, not to be pushed at anyone.
 */

/** Sessions to read. Three, as asked — a week of training for most people. */
export const RECOMMEND_LOOKBACK = 3;

/** How many to mark. Enough to be a suggestion, few enough to stay a picker. */
export const RECOMMEND_LIMIT = 6;

/**
 * A muscle worked this many hard sets in the lookback counts as fully covered. Above
 * it there is nothing to recommend; the score is a shortfall, not a total.
 */
const COVERED_AT = 6;

/**
 * Muscles nobody plans a session around. They are trained by the compounds that hit
 * everything else, so leaving them in makes the recommendation a permanent argument
 * for forearm work.
 */
const INCIDENTAL: ReadonlySet<string> = new Set(['forearms', 'neck', 'full_body', 'obliques']);

export interface RecommendOptions {
  readonly lookback?: number;
  readonly limit?: number;
  /** Exercise ids already in the session being built; never recommend those again. */
  readonly excludeIds?: readonly string[];
}

/**
 * Ids to mark as recommended, best first.
 *
 * @param sessions past sessions in any order; the most recent `lookback` are read
 */
export function recommendedExerciseIds(
  sessions: readonly CompletedSession[],
  catalogue: readonly CatalogueEntry[],
  options: RecommendOptions = {},
): string[] {
  const limit = options.limit ?? RECOMMEND_LIMIT;
  const exclude = new Set(options.excludeIds ?? []);

  // No history is no opinion. Returning "everything is neglected" would rank the
  // catalogue by an arbitrary tiebreak and dress it up as advice.
  const recent = mostRecent(sessions, options.lookback ?? RECOMMEND_LOOKBACK);
  if (recent.length === 0) return [];

  const shortfall = shortfallByMuscle(recent);
  const familiar = familiarIds(sessions);

  const scored: { readonly id: string; readonly score: number; readonly known: boolean }[] = [];
  for (const entry of catalogue) {
    if (exclude.has(entry.id)) continue;
    // Already done in the lookback window: it is not a gap, whatever its muscles say.
    if (trainedRecently(recent, entry.id)) continue;
    if (!suggestable(entry.id, familiar)) continue;

    /*
     * The *worst* gap this exercise addresses, not the sum of all of them.
     *
     * Summing looks reasonable and is badly wrong: it scores an exercise once per
     * muscle, so anything touching eight muscles beats anything focused, whatever the
     * actual shortfall. Measured, that put "Tire Flip", "Keg Load" and "Sandbag Load"
     * at the top of a picker for someone who had skipped back day. Taking the max asks
     * the question that matters — how well does this address the thing I am most short
     * of — and a compound still wins when it is genuinely the best answer for that one
     * muscle.
     */
    let score = 0;
    for (const share of entry.muscles) {
      if (share.fraction < 0.5) continue;
      score = Math.max(score, (shortfall.get(share.muscle) ?? 0) * share.fraction);
    }
    if (score <= 0) continue;
    scored.push({ id: entry.id, score, known: familiar.has(entry.id) });
  }

  const position = new Map(catalogue.map((entry, index) => [String(entry.id), index]));
  scored.sort((left, right) => {
    // Familiarity first, then the size of the gap. A known lift that half-addresses a
    // gap beats a stranger that fully addresses it: the lifter has to actually do it.
    if (left.known !== right.known) return left.known ? -1 : 1;
    if (right.score !== left.score) return right.score - left.score;
    /*
     * Catalogue order, not alphabetical.
     *
     * Scores tie constantly — an untrained muscle is a shortfall of exactly
     * `COVERED_AT` and a primary muscle is a fraction of exactly 1 — so the tiebreak is
     * doing most of the ordering, and `localeCompare` made that the alphabet. Measured,
     * that led with "Assisted Pull-Up" and "Band Pull-Apart" over "Barbell Row". The
     * curated set is declared staples-first, so its own order is the better answer, and
     * it is the same rule the empty-query search uses.
     */
    return (position.get(left.id) ?? 0) - (position.get(right.id) ?? 0);
  });

  return spreadAcrossMuscles(scored, catalogue, shortfall, limit);
}

function mostRecent(
  sessions: readonly CompletedSession[],
  lookback: number,
): readonly CompletedSession[] {
  return [...sessions].sort((left, right) => right.startedAt - left.startedAt).slice(0, lookback);
}

/** How many hard sets each muscle is short of {@link COVERED_AT} across the window. */
function shortfallByMuscle(sessions: readonly CompletedSession[]): Map<MuscleGroup, number> {
  const done = new Map<string, number>();
  for (const session of sessions) {
    for (const exercise of session.exercises) {
      const counts = hardSetsByMuscle(exercise.sets.map(toPerformedSet), exercise.exercise);
      for (const [muscle, n] of Object.entries(counts)) {
        done.set(muscle, (done.get(muscle) ?? 0) + n);
      }
    }
  }

  const shortfall = new Map<MuscleGroup, number>();
  for (const muscle of everyTrainedMuscle(done)) {
    if (INCIDENTAL.has(muscle)) continue;
    const gap = COVERED_AT - (done.get(muscle) ?? 0);
    if (gap > 0) shortfall.set(muscle as MuscleGroup, gap);
  }
  return shortfall;
}

/**
 * The muscles worth scoring: everything the catalogue can train.
 *
 * Read off the sessions plus a fixed list rather than `MUSCLE_GROUPS` wholesale, so a
 * muscle nothing in the catalogue trains cannot become a permanent unfillable gap.
 */
function everyTrainedMuscle(done: ReadonlyMap<string, number>): readonly string[] {
  return [...new Set([...PLANNABLE, ...done.keys()])];
}

/** The muscles people actually build a session around. */
const PLANNABLE: readonly string[] = [
  'chest',
  'front_delts',
  'side_delts',
  'rear_delts',
  'lats',
  'upper_back',
  'traps',
  'lower_back',
  'biceps',
  'triceps',
  'abs',
  'glutes',
  'quads',
  'hamstrings',
  'calves',
];

/** Ids of the hand-written set, which is also the set worth suggesting unprompted. */
const CURATED: ReadonlySet<string> = new Set(STARTER_CATALOGUE.map((entry) => entry.id));

/**
 * Is this something to put in front of somebody who did not ask for it?
 *
 * Only the curated seventy, plus anything they have actually done. The other ~830 rows
 * exist so that a lifter searching for a straight-arm pulldown finds one — they are a
 * long tail to be *found*, not a pool to recommend from. Left unfiltered, the strongman
 * corner of the dataset surfaces first, which is how "Keg Load" ended up being offered
 * to someone who had skipped a pull day.
 */
function suggestable(id: string, familiar: ReadonlySet<string>): boolean {
  return CURATED.has(id) || familiar.has(id);
}

function trainedRecently(sessions: readonly CompletedSession[], exerciseId: string): boolean {
  return sessions.some((session) =>
    session.exercises.some((exercise) => exercise.exercise.exerciseId === exerciseId),
  );
}

/** Every exercise id this lifter has ever logged. */
function familiarIds(sessions: readonly CompletedSession[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const session of sessions) {
    for (const exercise of session.exercises) ids.add(exercise.exercise.exerciseId);
  }
  return ids;
}

/**
 * One exercise per neglected muscle, most neglected first, then go round again.
 *
 * ## Why not simply the top N
 *
 * Because the scores tie, constantly. A muscle untrained across the window has a
 * shortfall of exactly `COVERED_AT`, and a primary muscle has a fraction of exactly 1,
 * so every lift for every untrained muscle scores the same. Taking the first six of
 * that list means the tiebreak picks the whole answer — and measured, it did: three
 * push days produced six leg exercises and nothing for the back, even though the back
 * was exactly as neglected. Alphabetical order had the same failure with different
 * winners ("Assisted Pull-Up", "Band Pull-Apart").
 *
 * Round-robin makes breadth the property that holds regardless of ties. Somebody who
 * skipped a pull day sees rows and pulldowns *and* squats and curls — the shape of the
 * gap, which is the only thing this can honestly claim to know.
 *
 * A second pass adds a variant for the worst-off muscles, so the list is not six
 * different muscles when only three are actually short.
 */
function spreadAcrossMuscles(
  scored: readonly { readonly id: string; readonly score: number }[],
  catalogue: readonly CatalogueEntry[],
  shortfall: ReadonlyMap<MuscleGroup, number>,
  limit: number,
): string[] {
  const byId = new Map<string, CatalogueEntry>(catalogue.map((entry) => [entry.id, entry]));

  // Candidates bucketed by the muscle they are primarily for, each bucket already in
  // the order `scored` established.
  const buckets = new Map<string, string[]>();
  for (const candidate of scored) {
    const primary = byId.get(candidate.id)?.muscles[0]?.muscle;
    if (primary === undefined) continue;
    const bucket = buckets.get(primary);
    if (bucket === undefined) buckets.set(primary, [candidate.id]);
    else bucket.push(candidate.id);
  }

  /*
   * Muscles in order of how short they are, ties broken by where that muscle's best
   * candidate sits in the catalogue.
   *
   * The ties are the common case, not the edge case: everything untrained across the
   * window is short by exactly `COVERED_AT`. Breaking them by muscle *name* meant "abs"
   * led the list for every lifter forever, which is an alphabet showing through the UI.
   * Catalogue position instead lets the curated order — declared staples first — decide,
   * so a neglected back outranks neglected abs without anyone hard-coding that opinion.
   */
  const position = new Map(catalogue.map((entry, index) => [String(entry.id), index]));
  const rankOf = (muscle: string): number => position.get(buckets.get(muscle)?.[0] ?? '') ?? 0;
  const muscles = [...buckets.keys()].sort((left, right) => {
    const gap = (shortfall.get(right as MuscleGroup) ?? 0) - (shortfall.get(left as MuscleGroup) ?? 0);
    return gap !== 0 ? gap : rankOf(left) - rankOf(right);
  });

  const out: string[] = [];
  // Two rounds: one exercise for each neglected muscle, then a second for the worst.
  for (let round = 0; round < 2 && out.length < limit; round += 1) {
    for (const muscle of muscles) {
      if (out.length >= limit) break;
      const pick = buckets.get(muscle)?.[round];
      if (pick !== undefined) out.push(pick);
    }
  }
  return out;
}
