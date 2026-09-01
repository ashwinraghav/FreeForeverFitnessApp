/**
 * `@freeforever/core/training` — the maths behind the workout log.
 *
 * Pure, deterministic, dependency-free. No React, no Firebase, no network, no clock:
 * every function here is a fold over values the caller already holds. That is not
 * fastidiousness, it is the free-forever constitution — rule 1 says every feature has
 * a zero-cost path, and progressive overload, estimated maxes, plate maths and PR
 * detection are the four places a fitness app is most tempted to reach for a server.
 * None of them need one.
 *
 * Re-exported from `packages/core/src/index.ts`, so consumers import
 * `@freeforever/core` rather than deep-importing this path.
 */

export {
  distanceOf,
  durationOf,
  isAttempted,
  isRecordEligible,
  isWarmup,
  isWorking,
  ratingOfPerceivedExertion,
  repsInReserve,
  repsOf,
} from './types.js';
export type {
  Effort,
  EffortRating,
  ExerciseShape,
  Load,
  LoadContext,
  MuscleShare,
  PerformedSet,
  SetKind,
  SetState,
} from './types.js';

export {
  effectiveLoadKg,
  externalLoadKg,
  fromGrams,
  isHeavierBetter,
  round4,
  toGrams,
} from './load.js';
export type { EffectiveLoadOptions } from './load.js';

export {
  consensusOneRepMax,
  DEFAULT_E1RM_FORMULA,
  E1RM_FORMULA_NAMES,
  estimateOneRepMax,
  estimateRepMax,
  isReliableRepRange,
  loadForReps,
  MAX_RELIABLE_REPS,
  oneRepMaxMultiplier,
  repsAtLoad,
} from './e1rm.js';
export type { E1rmFormula } from './e1rm.js';

export {
  closestLoadableKg,
  EZ_BAR_KG,
  IMPERIAL_BAR_KG,
  IMPERIAL_PLATE_STOCK,
  loadableWeightsKg,
  METRIC_PLATE_STOCK,
  OLYMPIC_BAR_KG,
  perSideKg,
  roundToIncrement,
  solvePlateLoad,
  WOMENS_BAR_KG,
} from './plates.js';
export type {
  BarSetup,
  LoadingMode,
  PlateLoad,
  PlateLoadImpossible,
  PlatePlacement,
  PlateRounding,
  PlateSolution,
  PlateSolveOptions,
  PlateStock,
} from './plates.js';

export {
  hardSetCount,
  hardSetsByMuscle,
  isVolumeEligible,
  sessionTotals,
  setVolumeKg,
  tonnageKg,
  volumeKgByMuscle,
} from './volume.js';
export type { SessionExercise, SessionTotals, VolumeOptions } from './volume.js';

export { consecutiveMisses, nextPrescription, summariseSession } from './progression.js';
export type {
  DoubleProgressionScheme,
  ExerciseSession,
  LinearScheme,
  PercentOfMaxScheme,
  Prescription,
  ProgressionAction,
  ProgressionScheme,
  RepRange,
  RpeScheme,
  SessionSummary,
  TimeLinearScheme,
} from './progression.js';

export { beatsRecord, detectRecords, PR_TYPES, TRACKED_REP_MAXES } from './records.js';
export type {
  CandidateSet,
  CurrentBests,
  DetectRecordsOptions,
  PrType,
  RecordDetection,
  RecordDetectionResult,
  RepMaxes,
} from './records.js';

export {
  MAX_CREDITED_MINUTES,
  RESISTANCE_TRAINING_MET,
  sessionEnergyKcal,
} from './energy.js';
export type { SessionEnergyInput } from './energy.js';
