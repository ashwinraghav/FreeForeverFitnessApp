/**
 * What a session probably cost, in kilocalories.
 *
 * **This never touches the calorie target, and that is a design decision rather
 * than an omission.** The target comes from BMR times a standing activity
 * multiplier, and that multiplier already assumes you train — "moderately
 * active" is 1.55 on every day of the week, rest days included. Adding a
 * per-session figure on top would count the same training twice and inflate the
 * budget, which is the well-known way calorie apps quietly stop working. So this
 * is a statistic you read, next to volume and duration, and nothing consumes it.
 *
 * The right correction for a target is the scale over a fortnight: if intake is
 * flat and weight is flat, expenditure equals intake, whatever any formula says.
 * `energy.ts` in `core/nutrition` says the same thing about its own estimate.
 *
 * THE MODEL, IN FULL
 *
 * `kcal = MET x 3.5 x kg / 200 x minutes`, the standard conversion — a MET is
 * 3.5 ml O2 per kg per minute, and a litre of O2 is about 5 kcal.
 *
 * One MET value for the whole session. The Compendium of Physical Activities
 * gives 3.5 for light-to-moderate general resistance training, 5.0 for
 * squat/deadlift work at slow or explosive effort, and 6.0 for multiple
 * exercises at 8-15 reps and vigorous intensity. Logged strength training is
 * mostly rest — a set is 30 seconds and the gap is two to three minutes — so the
 * session average sits near the bottom of that range, not the top.
 *
 * Picking 3.5 is therefore deliberate and deliberately conservative. Every
 * incentive here points at over-estimating, and an over-estimate is the one that
 * does harm: it flatters the user and, if anyone ever wires this into a deficit,
 * it eats the deficit. A number that is honestly low is the safer error.
 *
 * WHAT THIS DOES NOT MODEL
 *
 * Effort, load, rest length, set density, EPOC, training age, or body
 * composition. Estimates of strength-training expenditure carry error bars wide
 * enough that a more elaborate model would be false precision rather than
 * accuracy. Duration and bodyweight are the two inputs we actually know.
 */

/**
 * Compendium of Physical Activities, code 02054 — "resistance training, light or
 * moderate effort, general". See the note above on why the low end of the range.
 */
export const RESISTANCE_TRAINING_MET = 3.5;

/** ml O2 per kg per minute, per MET. */
const ML_O2_PER_MET = 3.5;

/**
 * Sessions longer than this are not credited further. Mirrors the idle cap in
 * the workout model: a phone left in a locker must not be able to bank a
 * nine-hour burn.
 */
export const MAX_CREDITED_MINUTES = 4 * 60;

export interface SessionEnergyInput {
  readonly durationSec: number;
  /** Undefined when the lifter has never recorded one. */
  readonly bodyweightKg?: number | undefined;
  readonly met?: number;
}

/**
 * Kilocalories, or `null` when we genuinely cannot say.
 *
 * `null` rather than `0`: a session with no recorded bodyweight is unknown, not
 * free, and the summary already distinguishes those two facts for volume. A
 * number invented from a default weight would look identical to a measured one.
 */
export function sessionEnergyKcal(input: SessionEnergyInput): number | null {
  const { durationSec, bodyweightKg, met = RESISTANCE_TRAINING_MET } = input;
  if (bodyweightKg === undefined || !Number.isFinite(bodyweightKg) || bodyweightKg <= 0) return null;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;

  const minutes = Math.min(durationSec / 60, MAX_CREDITED_MINUTES);
  const kcal = (met * ML_O2_PER_MET * bodyweightKg) / 200 * minutes;
  return Math.round(kcal);
}
