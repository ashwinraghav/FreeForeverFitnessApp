import { DEFAULT_E1RM_FORMULA, estimateOneRepMax, type E1rmFormula } from './e1rm.js';
import { effectiveLoadKg, round4 } from './load.js';
import type { LoadContext, PerformedSet } from './types.js';
import { distanceOf, durationOf, isRecordEligible, repsOf } from './types.js';

/**
 * Personal record detection.
 *
 * The rule that governs every function here is one line in `workout.ts`:
 * `isRecordEligible` — a record is only ever set by a **completed working set**. A
 * failed heavy single is not a record however close it was, and a warmup is not a
 * record however heavy the lifter's warmups are. Both exclusions are load-bearing: a
 * training log that congratulates you for a set you missed is a log you stop reading.
 *
 * Detection is a pure fold over one session against the records already held, so it
 * runs offline on a cold cache with no query (ADR-0005). The `personalRecords`
 * document id is derived from the exercise key precisely so that "did this beat
 * anything?" is a cache hit on a known id.
 */

/** Mirrors `PR_TYPES` in `@freeforever/data`. */
export const PR_TYPES = [
  'heaviest_weight',
  'best_e1rm',
  'most_reps',
  'best_set_volume',
  'best_session_volume',
  'best_duration',
  'best_distance',
] as const;

export type PrType = (typeof PR_TYPES)[number];

/** Rep counts a rep max is tracked at. Mirrors `TRACKED_REP_MAXES`. */
export const TRACKED_REP_MAXES = [1, 2, 3, 5, 8, 10, 12] as const;

/** A set identified well enough to attribute a record to it. */
export interface CandidateSet extends PerformedSet {
  readonly setId: string;
}

/** The current bests, keyed by PR type. Values are in the type's canonical unit. */
export type CurrentBests = Partial<Record<PrType, number>>;

/** Heaviest load completed for exactly N reps, keyed by N as a string. */
export type RepMaxes = Partial<Record<string, number>>;

export interface RecordDetection {
  readonly type: PrType;
  /** Canonical value: kg, reps, kg of volume, seconds or metres. */
  readonly value: number;
  /** Absent for session-scoped records, which are not attributable to one set. */
  readonly setId?: string;
  readonly loadKg?: number;
  readonly reps?: number;
  readonly durationSec?: number;
  readonly distanceM?: number;
  readonly e1rmKg?: number;
  /** What this beat. Absent for a first record. */
  readonly previousValue?: number;
}

export interface RecordDetectionResult {
  readonly achievements: readonly RecordDetection[];
  /**
   * Rep maxes this session improved, keyed by rep count. Only the tracked counts, and
   * only where the load actually beat what was held.
   */
  readonly repMaxKgByReps: RepMaxes;
}

export interface DetectRecordsOptions extends LoadContext {
  readonly formula?: E1rmFormula;
}

/**
 * Which of a session's sets beat which records.
 *
 * Session-scoped records (`best_session_volume`) carry no `setId`, by design — the
 * total is not attributable to one set and pretending otherwise puts a misleading
 * link in the PR timeline.
 */
export function detectRecords(
  sets: readonly CandidateSet[],
  current: CurrentBests = {},
  repMaxes: RepMaxes = {},
  options: DetectRecordsOptions = {},
): RecordDetectionResult {
  const formula = options.formula ?? DEFAULT_E1RM_FORMULA;
  const eligible = sets.filter(isRecordEligible);

  const best = new Map<PrType, RecordDetection>();
  const nextRepMaxes: Record<string, number> = {};
  let sessionVolume = 0;

  for (const set of eligible) {
    const loadKg = effectiveLoadKg(set.load, options);
    const reps = repsOf(set.effort);
    const durationSec = durationOf(set.effort);
    const distanceM = distanceOf(set.effort);

    if (loadKg !== null && loadKg > 0) {
      consider(best, {
        type: 'heaviest_weight',
        value: round4(loadKg),
        setId: set.setId,
        loadKg: round4(loadKg),
        ...(reps === null ? {} : { reps }),
      });
    }

    // `loadKg > 0` guards all four load-derived types together. Five reps with an
    // empty bar, or an assisted rep where the machine took the lifter's whole weight,
    // resolves to zero load — and "best set volume: 0kg" is not an achievement.
    if (loadKg !== null && loadKg > 0 && reps !== null && reps > 0) {
      const setVolume = round4(loadKg * reps);
      sessionVolume += setVolume;

      consider(best, {
        type: 'best_set_volume',
        value: setVolume,
        setId: set.setId,
        loadKg: round4(loadKg),
        reps,
      });

      consider(best, { type: 'most_reps', value: reps, setId: set.setId, loadKg: round4(loadKg), reps });

      const e1rm = estimateOneRepMax(loadKg, reps, formula);
      if (e1rm !== null) {
        consider(best, {
          type: 'best_e1rm',
          value: e1rm,
          setId: set.setId,
          loadKg: round4(loadKg),
          reps,
          e1rmKg: e1rm,
        });
      }

      // Rep maxes are exact, not interpolated: "heaviest load actually completed for
      // exactly N reps". An eight-rep set says nothing about the five-rep max that a
      // formula would not be inventing.
      if ((TRACKED_REP_MAXES as readonly number[]).includes(reps)) {
        const key = String(reps);
        const held = Math.max(repMaxes[key] ?? 0, nextRepMaxes[key] ?? 0);
        if (loadKg > held) nextRepMaxes[key] = round4(loadKg);
      }
    }

    if (durationSec !== null && durationSec > 0) {
      consider(best, {
        type: 'best_duration',
        value: durationSec,
        setId: set.setId,
        durationSec,
        ...(loadKg === null ? {} : { loadKg: round4(loadKg) }),
      });
    }

    if (distanceM !== null && distanceM > 0) {
      consider(best, {
        type: 'best_distance',
        value: distanceM,
        setId: set.setId,
        distanceM,
        ...(durationSec === null ? {} : { durationSec }),
      });
    }
  }

  if (sessionVolume > 0) {
    consider(best, { type: 'best_session_volume', value: round4(sessionVolume) });
  }

  const achievements: RecordDetection[] = [];
  for (const detection of best.values()) {
    // A record of zero is not a record. Belt and braces against a new PR type being
    // added later without its own positivity guard.
    if (detection.value <= 0) continue;
    const previous = current[detection.type];
    if (previous !== undefined && detection.value <= previous) continue;
    achievements.push(previous === undefined ? detection : { ...detection, previousValue: previous });
  }

  achievements.sort((left, right) => PR_TYPES.indexOf(left.type) - PR_TYPES.indexOf(right.type));
  return { achievements, repMaxKgByReps: nextRepMaxes };
}

/**
 * True when this one set beats the held record of the given type.
 *
 * The mid-set question: the row that just went green wants to know whether to show a
 * PR marker, and it wants to know without folding the whole session again.
 */
export function beatsRecord(
  set: CandidateSet,
  type: PrType,
  current: CurrentBests,
  options: DetectRecordsOptions = {},
): boolean {
  const { achievements } = detectRecords([set], current, {}, options);
  return achievements.some((achievement) => achievement.type === type);
}

/** Keep the best candidate per type as the session is walked. Ties keep the earlier set. */
function consider(best: Map<PrType, RecordDetection>, candidate: RecordDetection): void {
  const held = best.get(candidate.type);
  if (held === undefined || candidate.value > held.value) best.set(candidate.type, candidate);
}
