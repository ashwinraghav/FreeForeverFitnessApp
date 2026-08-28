/**
 * Muscle vocabulary, and the deltoid split.
 *
 * free-exercise-db has one muscle called `shoulders`. Anyone tracking volume
 * needs three, because the anterior, lateral and posterior heads are trained by
 * different movements and a programme that presses a lot and never rows is a
 * programme with a hole in it that a single `shoulders` number hides.
 *
 * The obvious inference is from `force`: push -> front, pull -> rear. It is
 * wrong often enough to matter. In this dataset "Side Lateral Raise",
 * "One-Arm Side Laterals", "Seated Side Lateral Raise", "Alternating Deltoid
 * Raise" and "Lateral Raise - With Bands" are all marked `push` and are all
 * lateral-head work; "Cable Seated Lateral Raise" is marked `pull` and is also
 * lateral. Movement names carry the information that `force` does not.
 *
 * So: match names first, fall back to the movement class, and where neither is
 * conclusive **emit the generic `shoulders` and say so** rather than guessing.
 * An honest "unspecified" is more useful to a consumer than a confident wrong
 * answer, because they can decide what to do about it; they cannot detect a
 * plausible mistake.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/** Canonical names. `shoulders` remains valid, meaning "deltoid, head unspecified". */
export const MUSCLE = {
  abdominals: 'abdominals',
  abductors: 'abductors',
  adductors: 'adductors',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'lats',
  'lower back': 'lower-back',
  'middle back': 'mid-back',
  neck: 'neck',
  quadriceps: 'quads',
  shoulders: 'shoulders',
  traps: 'traps',
  triceps: 'triceps',
};

/** Rolls a specific head up to the group a consumer may still want to total. */
export const MUSCLE_GROUP = {
  'front-delts': 'shoulders',
  'side-delts': 'shoulders',
  'rear-delts': 'shoulders',
};

/** Every value that can appear in `primaryMuscles` / `secondaryMuscles`. */
export const ALL_MUSCLES = [
  ...new Set([...Object.values(MUSCLE), ...Object.keys(MUSCLE_GROUP)]),
].sort();

/**
 * Posterior head. Note that the rotator-cuff movements (external rotation)
 * land here: the dataset has no rotator cuff, the posterior deltoid is the
 * nearest true thing, and the alternative is discarding the record.
 */
const REAR =
  /rear.?delt|rear lateral|reverse fl(y|ie)|face pull|(band )?pull apart|back fl(y|ie)|row to neck|bent.?over.*(lateral|raise|fl(y|ie))|lying.*(rear|lateral)|external rotation|reverse machine|sled reverse/i;

/** Lateral head. */
const SIDE =
  /lateral raise|side lateral|deltoid raise|upright.*row|scaption|iron cross|crucifix|arm circles|shoulder circles|straight raises/i;

/**
 * Anterior head. The overhead and Olympic patterns are here because the
 * anterior deltoid is the prime mover in any press to lockout, and the
 * catch/overhead-support position of a snatch, jerk or get-up loads it hardest.
 */
const FRONT =
  /front .*raise|front delt|shoulder press|military|overhead press|push press|\bjerk\b|arnold|bradford|clean and press|handstand push|thruster|press behind|behind the neck|shoulder raise|\bsnatch\b|\bclean\b|log lift|circus bell|jammer|get-?up|\bpress\b/i;

/**
 * Movement-class fallback for the secondary-muscle case, where the exercise is
 * named for what it primarily trains ("Barbell Bench Press", "Bent Over Row")
 * and the deltoid involvement follows from the movement rather than the name.
 */
const PRESS_LIKE = /press|bench|\bdips?\b|push.?up|\bfl(y|ie)|cross.?over/i;
const PULL_LIKE = /\brow\b|pull|chin|lat |curl/i;

/**
 * Split `shoulders` into the heads a movement actually trains.
 *
 * @param {string} name  the exercise's display name
 * @param {boolean} isPrimary  primary muscles get name rules only; secondary
 *        muscles also get the movement-class fallback
 * @returns {{heads:string[], basis:'name'|'movement'|'unspecified'}}
 */
export function splitShoulders(name, isPrimary) {
  /** @type {string[]} */
  const heads = [];
  if (FRONT.test(name)) heads.push('front-delts');
  if (SIDE.test(name)) heads.push('side-delts');
  if (REAR.test(name)) heads.push('rear-delts');
  if (heads.length > 0) return { heads, basis: 'name' };

  if (!isPrimary) {
    if (PRESS_LIKE.test(name)) return { heads: ['front-delts'], basis: 'movement' };
    if (PULL_LIKE.test(name)) return { heads: ['rear-delts'], basis: 'movement' };
  }

  // Turkish get-ups, battling ropes, shoulder stretches: genuinely all three or
  // genuinely unclear. Say so.
  return { heads: ['shoulders'], basis: 'unspecified' };
}

/**
 * Map an upstream muscle name to ours, splitting the deltoids.
 *
 * @param {string[]} upstream
 * @param {string} exerciseName
 * @param {boolean} isPrimary
 * @returns {{muscles:string[], basis:string|null, unknown:string[]}}
 */
export function mapMuscles(upstream, exerciseName, isPrimary) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const unknown = [];
  /** @type {string|null} */
  let basis = null;

  for (const raw of upstream) {
    const key = String(raw).toLowerCase().trim();
    const mapped = MUSCLE[/** @type {keyof typeof MUSCLE} */ (key)];
    if (!mapped) {
      // Never silently drop. An unrecognised muscle means free-exercise-db has
      // been rebuilt with a name we do not know, and the build should say so
      // rather than ship an exercise with a hole in its muscle list.
      unknown.push(key);
      continue;
    }
    if (mapped === 'shoulders') {
      const split = splitShoulders(exerciseName, isPrimary);
      basis = split.basis;
      out.push(...split.heads);
    } else {
      out.push(mapped);
    }
  }
  return { muscles: [...new Set(out)], basis, unknown };
}
