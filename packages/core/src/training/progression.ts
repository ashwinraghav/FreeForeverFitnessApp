import { estimateOneRepMax, type E1rmFormula, DEFAULT_E1RM_FORMULA } from './e1rm.js';
import { effectiveLoadKg, round4 } from './load.js';
import { roundToIncrement } from './plates.js';
import type { LoadContext, PerformedSet } from './types.js';
import { durationOf, isWorking, repsInReserve, repsOf } from './types.js';

/**
 * Progressive overload.
 *
 * Every rule here reads the same three facts out of the last session — did every
 * working set get completed, how many reps was the worst of them, and how hard did it
 * feel — and turns them into one prescription. They are deterministic functions of
 * the log, with no model, no network and no per-user cost (ADR-0001 rule 1): this is
 * the zero-cost path that ADR-0016 requires to exist and to work standalone before
 * anything AI-flavoured is layered over it.
 *
 * Two invariants hold across all four schemes:
 *
 *   1. **A failed set never earns a progression.** `state: 'failed'` is exactly the
 *      signal these rules exist to read. Collapsing it into "not completed" throws
 *      the signal away; collapsing it into "completed" adds weight to a bar the
 *      lifter just missed.
 *   2. **Every prescribed load is rounded onto the increment the gym can make.** A
 *      prescription of 62.4kg is not a prescription.
 */

export interface RepRange {
  readonly min: number;
  readonly max: number;
}

/** Straight sets at a fixed rep target: make them all, add weight next time. */
export interface LinearScheme {
  readonly kind: 'linear';
  readonly targetReps: number;
  readonly incrementKg: number;
  /** How many working sets must be made. Defaults to however many were prescribed. */
  readonly setsRequired?: number;
  readonly deloadPercent?: number;
  readonly failuresBeforeDeload?: number;
}

/** Work up the rep range at one load, then add weight and drop back to the bottom. */
export interface DoubleProgressionScheme {
  readonly kind: 'double';
  readonly repRange: RepRange;
  readonly incrementKg: number;
  readonly deloadPercent?: number;
  readonly failuresBeforeDeload?: number;
}

/** Autoregulated: steer the load so the last set lands on a target RPE. */
export interface RpeScheme {
  readonly kind: 'rpe';
  readonly targetRpe: number;
  readonly reps: number;
  readonly incrementKg: number;
  /** Half a point either side is noise, not a signal. */
  readonly toleranceRpe?: number;
  /** Load change per point of RPE. 3% is the usual working figure. */
  readonly percentPerRpePoint?: number;
}

/** A percentage of the estimated max, the way a block programme is written. */
export interface PercentOfMaxScheme {
  readonly kind: 'percent_1rm';
  readonly percent: number;
  readonly reps: number;
  readonly incrementKg: number;
  readonly formula?: E1rmFormula;
}

/** Timed holds. The only thing that progresses is the clock. */
export interface TimeLinearScheme {
  readonly kind: 'time_linear';
  readonly targetSec: number;
  readonly incrementSec: number;
  readonly failuresBeforeDeload?: number;
  readonly deloadPercent?: number;
}

export type ProgressionScheme =
  | LinearScheme
  | DoubleProgressionScheme
  | RpeScheme
  | PercentOfMaxScheme
  | TimeLinearScheme;

export type ProgressionAction =
  | 'first_session'
  | 'add_load'
  | 'add_reps'
  | 'add_time'
  | 'hold'
  | 'repeat'
  | 'deload';

export interface Prescription {
  readonly action: ProgressionAction;
  /** `null` when there is no history to base a load on. */
  readonly loadKg: number | null;
  readonly reps: number | null;
  readonly durationSec: number | null;
  readonly repRange: RepRange | null;
  /** Change against the last session's working load, kg. Zero on a hold. */
  readonly changeKg: number;
  /**
   * Why, in words that fit on one line at arm's length. No paragraphs in the workout
   * flow (CLAUDE.md) — this is read between sets, not studied.
   */
  readonly reason: string;
}

/** One past session of a single exercise. */
export interface ExerciseSession {
  /** Device wall clock, for ordering. Sessions are sorted defensively. */
  readonly performedAt: number;
  readonly sets: readonly PerformedSet[];
  /** Bodyweight and bar mass as they were that day. */
  readonly context?: LoadContext;
}

/** What one past session says, once the warmups and untouched sets are dropped. */
export interface SessionSummary {
  /** Heaviest effective load across attempted working sets, kg. */
  readonly topLoadKg: number | null;
  /** Fewest reps of any attempted working set — the one that decides progression. */
  readonly minReps: number | null;
  readonly maxReps: number | null;
  readonly longestHoldSec: number | null;
  readonly attemptedSets: number;
  readonly allCompleted: boolean;
  readonly anyFailed: boolean;
  /** Reps in reserve on the last attempted working set, when one was recorded. */
  readonly lastRir: number | null;
  readonly bestE1rmKg: number | null;
}

/** Reduce one session of an exercise to the facts a progression rule reads. */
export function summariseSession(
  session: ExerciseSession,
  formula: E1rmFormula = DEFAULT_E1RM_FORMULA,
): SessionSummary {
  const working = session.sets.filter((set) => isWorking(set) && set.state !== 'pending');

  let topLoad: number | null = null;
  let minReps: number | null = null;
  let maxReps: number | null = null;
  let longestHold: number | null = null;
  let bestE1rm: number | null = null;
  let lastRir: number | null = null;
  let allCompleted = working.length > 0;
  let anyFailed = false;

  for (const set of working) {
    if (set.state === 'failed') {
      anyFailed = true;
      allCompleted = false;
    }

    const load = effectiveLoadKg(set.load, session.context ?? {});
    if (load !== null && (topLoad === null || load > topLoad)) topLoad = load;

    const reps = repsOf(set.effort);
    if (reps !== null) {
      if (minReps === null || reps < minReps) minReps = reps;
      if (maxReps === null || reps > maxReps) maxReps = reps;
      if (load !== null && set.state === 'completed') {
        const estimate = estimateOneRepMax(load, reps, formula);
        if (estimate !== null && (bestE1rm === null || estimate > bestE1rm)) bestE1rm = estimate;
      }
    }

    const held = durationOf(set.effort);
    if (held !== null && (longestHold === null || held > longestHold)) longestHold = held;

    if (set.effortRating !== undefined) lastRir = repsInReserve(set.effortRating);
  }

  return {
    topLoadKg: topLoad,
    minReps,
    maxReps,
    longestHoldSec: longestHold,
    attemptedSets: working.length,
    allCompleted,
    anyFailed,
    lastRir,
    bestE1rmKg: bestE1rm,
  };
}

/**
 * The next prescription for one exercise.
 *
 * @param history past sessions of this exercise in any order; the most recent is used
 *                and the run of consecutive misses before it decides a deload.
 */
export function nextPrescription(
  history: readonly ExerciseSession[],
  scheme: ProgressionScheme,
): Prescription {
  const ordered = [...history].sort((left, right) => left.performedAt - right.performedAt);
  const formula = scheme.kind === 'percent_1rm' ? (scheme.formula ?? DEFAULT_E1RM_FORMULA) : DEFAULT_E1RM_FORMULA;
  const summaries = ordered.map((session) => summariseSession(session, formula));
  const last = summaries[summaries.length - 1];

  if (last === undefined || last.attemptedSets === 0) {
    return firstSession(scheme, summaries);
  }

  switch (scheme.kind) {
    case 'linear':
      return linear(scheme, last, summaries);
    case 'double':
      return doubleProgression(scheme, last, summaries);
    case 'rpe':
      return rpe(scheme, last);
    case 'percent_1rm':
      return percentOfMax(scheme, summaries);
    case 'time_linear':
      return timeLinear(scheme, last, summaries);
  }
}

/**
 * How many of the most recent sessions in a row failed to make the prescription.
 * Reads backwards and stops at the first success, so one good week resets the count.
 *
 * `met` decides what counts as a success, and it is a parameter rather than a
 * constant because the schemes genuinely disagree. Under double progression a session
 * where every set was completed at eight reps instead of ten is progress. Under
 * linear 3x5 the same session is a miss. Hard-coding "no failed sets" would make the
 * deload on a linear programme never fire for the lifter who grinds out four reps
 * every week and calls each one completed.
 */
export function consecutiveMisses(
  summaries: readonly SessionSummary[],
  met: (summary: SessionSummary) => boolean = (summary) => summary.allCompleted,
): number {
  let misses = 0;
  for (let index = summaries.length - 1; index >= 0; index -= 1) {
    const summary = summaries[index] as SessionSummary;
    if (summary.attemptedSets === 0) continue;
    if (met(summary)) break;
    misses += 1;
  }
  return misses;
}

function firstSession(
  scheme: ProgressionScheme,
  summaries: readonly SessionSummary[],
): Prescription {
  const base: Omit<Prescription, 'reps' | 'repRange' | 'durationSec'> = {
    action: 'first_session',
    loadKg: null,
    changeKg: 0,
    reason: 'First time — pick a load',
  };

  switch (scheme.kind) {
    case 'linear':
      return { ...base, reps: scheme.targetReps, repRange: null, durationSec: null };
    case 'double':
      return { ...base, reps: scheme.repRange.min, repRange: scheme.repRange, durationSec: null };
    case 'rpe':
      return {
        ...base,
        reps: scheme.reps,
        repRange: null,
        durationSec: null,
        reason: `First time — work to RPE ${scheme.targetRpe}`,
      };
    case 'percent_1rm':
      return percentOfMax(scheme, summaries);
    case 'time_linear':
      return { ...base, reps: null, repRange: null, durationSec: scheme.targetSec };
  }
}

function linear(
  scheme: LinearScheme,
  last: SessionSummary,
  summaries: readonly SessionSummary[],
): Prescription {
  const load = last.topLoadKg;
  const required = scheme.setsRequired ?? last.attemptedSets;
  const met = (summary: SessionSummary): boolean =>
    summary.allCompleted &&
    summary.minReps !== null &&
    summary.minReps >= scheme.targetReps &&
    summary.attemptedSets >= (scheme.setsRequired ?? summary.attemptedSets);
  const success = met(last);

  if (load === null) {
    return {
      action: 'hold',
      loadKg: null,
      reps: scheme.targetReps,
      durationSec: null,
      repRange: null,
      changeKg: 0,
      reason: 'No load recorded',
    };
  }

  if (success) {
    const next = roundToIncrement(load + scheme.incrementKg, scheme.incrementKg);
    return {
      action: 'add_load',
      loadKg: next,
      reps: scheme.targetReps,
      durationSec: null,
      repRange: null,
      changeKg: round4(next - load),
      reason: `All ${required} sets made — add ${formatKg(scheme.incrementKg)}`,
    };
  }

  return missOrDeload(scheme, load, summaries, scheme.targetReps, null, met);
}

function doubleProgression(
  scheme: DoubleProgressionScheme,
  last: SessionSummary,
  summaries: readonly SessionSummary[],
): Prescription {
  const load = last.topLoadKg;
  if (load === null) {
    return {
      action: 'hold',
      loadKg: null,
      reps: scheme.repRange.min,
      durationSec: null,
      repRange: scheme.repRange,
      changeKg: 0,
      reason: 'No load recorded',
    };
  }

  if (last.allCompleted && last.minReps !== null && last.minReps >= scheme.repRange.max) {
    const next = roundToIncrement(load + scheme.incrementKg, scheme.incrementKg);
    return {
      action: 'add_load',
      loadKg: next,
      reps: scheme.repRange.min,
      durationSec: null,
      repRange: scheme.repRange,
      changeKg: round4(next - load),
      reason: `Top of the range — add ${formatKg(scheme.incrementKg)}`,
    };
  }

  if (last.allCompleted && last.minReps !== null) {
    const target = Math.min(last.minReps + 1, scheme.repRange.max);
    return {
      action: 'add_reps',
      loadKg: load,
      reps: target,
      durationSec: null,
      repRange: scheme.repRange,
      changeKg: 0,
      reason: `Same weight — go for ${target}`,
    };
  }

  return missOrDeload(scheme, load, summaries, last.minReps ?? scheme.repRange.min, scheme.repRange);
}

function rpe(scheme: RpeScheme, last: SessionSummary): Prescription {
  const load = last.topLoadKg;
  const tolerance = scheme.toleranceRpe ?? 0.5;
  const percentPerPoint = scheme.percentPerRpePoint ?? 3;
  const targetRir = 10 - scheme.targetRpe;

  if (load === null || last.lastRir === null) {
    return {
      action: 'hold',
      loadKg: load,
      reps: scheme.reps,
      durationSec: null,
      repRange: null,
      changeKg: 0,
      reason: load === null ? 'No load recorded' : 'No RPE logged — repeat',
    };
  }

  // A miss overrides the rating. Someone who fails a set and still logs RPE 8 is
  // reporting how the reps they *made* felt, not that there was room to add weight.
  if (last.anyFailed) {
    return {
      action: 'repeat',
      loadKg: load,
      reps: scheme.reps,
      durationSec: null,
      repRange: null,
      changeKg: 0,
      reason: 'Missed a set — repeat',
    };
  }

  const rirGap = last.lastRir - targetRir;
  if (Math.abs(rirGap) <= tolerance) {
    return {
      action: 'hold',
      loadKg: load,
      reps: scheme.reps,
      durationSec: null,
      repRange: null,
      changeKg: 0,
      reason: `On target at RPE ${scheme.targetRpe}`,
    };
  }

  const adjusted = load * (1 + (rirGap * percentPerPoint) / 100);
  const next = Math.max(0, roundToIncrement(adjusted, scheme.incrementKg));
  const change = round4(next - load);

  if (change === 0) {
    return {
      action: 'hold',
      loadKg: load,
      reps: scheme.reps,
      durationSec: null,
      repRange: null,
      changeKg: 0,
      reason: `On target at RPE ${scheme.targetRpe}`,
    };
  }

  return {
    action: change > 0 ? 'add_load' : 'deload',
    loadKg: next,
    reps: scheme.reps,
    durationSec: null,
    repRange: null,
    changeKg: change,
    reason:
      rirGap > 0
        ? `Left ${formatReps(rirGap)} in reserve — up ${formatKg(Math.abs(change))}`
        : `Over target — down ${formatKg(Math.abs(change))}`,
  };
}

function percentOfMax(
  scheme: PercentOfMaxScheme,
  summaries: readonly SessionSummary[],
): Prescription {
  let best: number | null = null;
  for (const summary of summaries) {
    if (summary.bestE1rmKg !== null && (best === null || summary.bestE1rmKg > best)) {
      best = summary.bestE1rmKg;
    }
  }

  if (best === null) {
    return {
      action: 'first_session',
      loadKg: null,
      reps: scheme.reps,
      durationSec: null,
      repRange: null,
      changeKg: 0,
      reason: 'No max yet — pick a load',
    };
  }

  const previous = summaries[summaries.length - 1]?.topLoadKg ?? null;
  const next = roundToIncrement((best * scheme.percent) / 100, scheme.incrementKg);
  return {
    action: previous !== null && next > previous ? 'add_load' : 'hold',
    loadKg: next,
    reps: scheme.reps,
    durationSec: null,
    repRange: null,
    changeKg: previous === null ? 0 : round4(next - previous),
    reason: `${scheme.percent}% of ${formatKg(best)} max`,
  };
}

function timeLinear(
  scheme: TimeLinearScheme,
  last: SessionSummary,
  summaries: readonly SessionSummary[],
): Prescription {
  const held = last.longestHoldSec;
  if (held === null) {
    return {
      action: 'hold',
      loadKg: last.topLoadKg,
      reps: null,
      durationSec: scheme.targetSec,
      repRange: null,
      changeKg: 0,
      reason: 'No hold recorded',
    };
  }

  // Same trap as linear: a lifter who holds 40s of a 60s plank and marks the set
  // completed has not made the prescription, so `allCompleted` alone never fires the
  // deload. The target has to be part of what counts as a success.
  const met = (summary: SessionSummary): boolean =>
    summary.allCompleted && summary.longestHoldSec !== null && summary.longestHoldSec >= scheme.targetSec;

  if (met(last)) {
    return {
      action: 'add_time',
      loadKg: last.topLoadKg,
      reps: null,
      durationSec: scheme.targetSec + scheme.incrementSec,
      repRange: null,
      changeKg: 0,
      reason: `Held it — go ${scheme.incrementSec}s longer`,
    };
  }

  const misses = consecutiveMisses(summaries, met);
  const threshold = scheme.failuresBeforeDeload ?? 3;
  if (misses >= threshold) {
    const reduced = Math.max(
      scheme.incrementSec,
      Math.round((scheme.targetSec * (100 - (scheme.deloadPercent ?? 10))) / 100),
    );
    return {
      action: 'deload',
      loadKg: last.topLoadKg,
      reps: null,
      durationSec: reduced,
      repRange: null,
      changeKg: 0,
      reason: `${misses} misses — back to ${reduced}s`,
    };
  }

  return {
    action: 'repeat',
    loadKg: last.topLoadKg,
    reps: null,
    durationSec: scheme.targetSec,
    repRange: null,
    changeKg: 0,
    reason: `Go again for ${scheme.targetSec}s`,
  };
}

/**
 * The shared miss path: repeat the load until the run of misses hits the threshold,
 * then cut. A deload is triggered by a *run*, not by one bad night's sleep.
 */
function missOrDeload(
  scheme: LinearScheme | DoubleProgressionScheme,
  load: number,
  summaries: readonly SessionSummary[],
  reps: number,
  repRange: RepRange | null,
  met?: (summary: SessionSummary) => boolean,
): Prescription {
  const misses = met === undefined ? consecutiveMisses(summaries) : consecutiveMisses(summaries, met);
  const threshold = scheme.failuresBeforeDeload ?? 3;

  if (misses >= threshold) {
    const percent = scheme.deloadPercent ?? 10;
    const next = Math.max(
      0,
      roundToIncrement((load * (100 - percent)) / 100, scheme.incrementKg, 'down'),
    );
    return {
      action: 'deload',
      loadKg: next,
      reps: repRange === null ? reps : repRange.min,
      durationSec: null,
      repRange,
      changeKg: round4(next - load),
      reason: `${misses} misses — cut ${percent}%`,
    };
  }

  return {
    action: 'repeat',
    loadKg: load,
    reps,
    durationSec: null,
    repRange,
    changeKg: 0,
    reason: 'Missed it — go again',
  };
}

/** `2.5` not `2.50`, and `2.5kg` not `2.5 kilograms`. Read at arm's length. */
function formatKg(kg: number): string {
  const rounded = round4(kg);
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2).replace(/0+$/, '')}kg`;
}

function formatReps(reps: number): string {
  const rounded = Math.round(reps * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}
