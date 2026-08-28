import type { Equipment, ExerciseId, MuscleContribution, MuscleGroup } from '@freeforever/data';

import type { CatalogueEntry } from './types.js';

/**
 * The adapter from `@freeforever/datasets`' 873-entry exercise catalogue to the shape
 * the picker searches.
 *
 * ## Why this is a file and not an import
 *
 * The two vocabularies genuinely disagree, and the disagreements are not cosmetic.
 * The upstream data is free-exercise-db, which was built to describe exercises to
 * humans; `@freeforever/data`'s enums were built so a volume chart adds up. Three
 * places where that matters, all handled below and all lossy in a way worth stating:
 *
 *   1. **`shoulders` is sometimes one muscle upstream and three here.** `MUSCLE_GROUPS`
 *      splits front, side and rear delts because they are trained by different
 *      movements and a lifter tracking delt volume needs them apart. The dataset now
 *      names all three explicitly for most rows and maps straight through; where it
 *      still says only `shoulders`, this infers from `force` — a push is front delts,
 *      a pull is rear delts, anything else is side delts. Marked as an inference, not
 *      a fact, and now a fallback rather than the common path.
 *   2. **Contributions are a two-value scale, not real fractions.** Upstream has
 *      `primaryMuscles` and `secondaryMuscles` and no weighting, so this assigns 1.0
 *      and 0.5. The hand-written starter catalogue has better numbers because a human
 *      wrote them; this has 873 entries. Both beat an all-1.0 split, which is the one
 *      thing that would make every volume chart double-count.
 *   3. **`loadKind` and `effortKind` are inferred, not stated.** Upstream has no field
 *      for either. The rules below are deliberately conservative: anything not clearly
 *      bodyweight, assisted, timed or distance-based falls through to
 *      `external` + `reps`, which is the shape that degrades most gracefully — a
 *      lifter can always log a number of reps against a weight.
 *
 * ## Why nothing imports this yet
 *
 * `@freeforever/datasets` is a dependency of `@freeforever/web`, but its `exports`
 * field publishes only `"."`, and `src/index.mjs` exposes the food index and the media
 * helpers — not the exercise catalogue. So `build/exercises.json.gz` is unreachable:
 *
 *     Missing "./build/exercises.json.gz" specifier in "@freeforever/datasets"
 *
 * The datasets team needs to publish one of the two, and either is a small change:
 * an `exports` entry for the artefact, or (better) a reader alongside `FoodIndex` —
 * `openExerciseCatalogue()` — so the gunzip and the parse live with the data rather
 * than in every consumer.
 *
 * When it lands, `STARTER_CATALOGUE` in `starter.ts` is replaced by
 * `adaptCatalogue(await loadExercises())` and nothing else changes: the picker, the
 * search and their tests all sit behind {@link CatalogueEntry}. `fromDatasets.test.ts`
 * already validates this adapter against the real 873 rows read off disk, so the swap
 * is covered before it happens.
 */

/** The subset of `@freeforever/datasets`' `Exercise` this adapter reads. */
export interface DatasetExercise {
  readonly id: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly force?: 'push' | 'pull' | 'static' | null;
  readonly category?: string;
  readonly equipment?: string | null;
  readonly primaryMuscles?: readonly string[];
  readonly secondaryMuscles?: readonly string[];
}

/** Fraction assigned to a muscle upstream calls primary. */
export const PRIMARY_FRACTION = 1;
/** Fraction assigned to a muscle upstream calls secondary. */
export const SECONDARY_FRACTION = 0.5;

/**
 * Upstream muscle names to `MUSCLE_GROUPS`.
 *
 * `shoulders` is absent on purpose — it is resolved from `force`, see
 * {@link shoulderGroupFor}. The dataset now names the three delts explicitly for most
 * rows, so that inference is a fallback for the residue rather than the common path.
 */
const MUSCLE_BY_NAME: Readonly<Record<string, MuscleGroup>> = {
  abdominals: 'abs',
  abductors: 'abductors',
  adductors: 'adductors',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  'front-delts': 'front_delts',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'lats',
  'lower-back': 'lower_back',
  'mid-back': 'upper_back',
  neck: 'neck',
  quads: 'quads',
  'rear-delts': 'rear_delts',
  'side-delts': 'side_delts',
  traps: 'traps',
  triceps: 'triceps',
};

const EQUIPMENT_BY_NAME: Readonly<Record<string, Equipment>> = {
  bands: 'band',
  barbell: 'barbell',
  'body only': 'bodyweight',
  cable: 'cable',
  dumbbell: 'dumbbell',
  'e-z curl bar': 'ez_bar',
  'exercise ball': 'other',
  'foam roll': 'other',
  kettlebells: 'kettlebell',
  machine: 'machine',
  'medicine ball': 'medicine_ball',
};

/**
 * Which delt an upstream `shoulders` means, inferred from the movement's force.
 *
 * A press drives the front delt, a row or a pull-apart the rear. Everything else —
 * static work, and the raises the dataset does not classify — falls to the side delt,
 * which is the least wrong default for an unclassified shoulder movement.
 */
export function shoulderGroupFor(force: DatasetExercise['force']): MuscleGroup {
  if (force === 'push') return 'front_delts';
  if (force === 'pull') return 'rear_delts';
  return 'side_delts';
}

/** Names that mean the machine takes weight *off* rather than adding it. */
const ASSISTED = /\bassist(ed)?\b/i;
/** Names that mean the set is measured on a clock, not in reps. */
const TIMED = /\b(plank|hold|hang|isometric|wall sit)\b/i;
/** Names that mean the set is measured in distance. */
const DISTANCE = /\b(carry|walk|run|sprint|sled|farmer)/i;
/** Names that mean left and right are loaded separately. */
const UNILATERAL = /\b(single[- ]?(arm|leg)|one[- ]?(arm|leg)|alternat\w*|split squat|lunge|pistol)\b/i;

/**
 * Convert one upstream row, or `null` when it cannot be represented honestly.
 *
 * `null` rather than a lenient fallback for the one case that matters: an exercise
 * whose muscles do not map at all would otherwise enter the catalogue contributing to
 * no muscle, silently vanishing from every volume chart while still looking loggable.
 */
export function toCatalogueEntry(exercise: DatasetExercise): CatalogueEntry | null {
  const muscles = musclesOf(exercise);
  if (muscles.length === 0) return null;

  const equipment = EQUIPMENT_BY_NAME[exercise.equipment ?? ''] ?? 'other';
  const category = (exercise.category ?? '').toLowerCase();

  return {
    id: exercise.id as ExerciseId,
    name: exercise.name,
    aliases: [...(exercise.aliases ?? [])],
    equipment,
    loadKind: loadKindOf(exercise, equipment, category),
    effortKind: effortKindOf(exercise, category),
    muscles,
    unilateral: UNILATERAL.test(exercise.name),
  };
}

/** Convert a whole catalogue, dropping rows that cannot be represented. */
export function adaptCatalogue(exercises: readonly DatasetExercise[]): CatalogueEntry[] {
  const out: CatalogueEntry[] = [];
  for (const exercise of exercises) {
    const entry = toCatalogueEntry(exercise);
    if (entry !== null) out.push(entry);
  }
  return out;
}

/** Upstream muscle names this adapter does not understand. For a coverage test. */
export function unmappedMuscleNames(exercises: readonly DatasetExercise[]): string[] {
  const unknown = new Set<string>();
  for (const exercise of exercises) {
    for (const name of [...(exercise.primaryMuscles ?? []), ...(exercise.secondaryMuscles ?? [])]) {
      if (name !== 'shoulders' && MUSCLE_BY_NAME[name] === undefined) unknown.add(name);
    }
  }
  return [...unknown].sort();
}

/** Upstream equipment names this adapter does not understand. For a coverage test. */
export function unmappedEquipmentNames(exercises: readonly DatasetExercise[]): string[] {
  const unknown = new Set<string>();
  for (const exercise of exercises) {
    const name = exercise.equipment;
    if (name !== null && name !== undefined && EQUIPMENT_BY_NAME[name] === undefined) {
      unknown.add(name);
    }
  }
  return [...unknown].sort();
}

function musclesOf(exercise: DatasetExercise): MuscleContribution[] {
  // Deduplicated and primary-wins: a muscle listed as both primary and secondary
  // upstream must not end up in the array twice, or it is counted twice downstream.
  const byMuscle = new Map<MuscleGroup, number>();

  const add = (name: string, fraction: number) => {
    const group = name === 'shoulders' ? shoulderGroupFor(exercise.force) : MUSCLE_BY_NAME[name];
    if (group === undefined) return;
    const held = byMuscle.get(group);
    if (held === undefined || fraction > held) byMuscle.set(group, fraction);
  };

  for (const name of exercise.primaryMuscles ?? []) add(name, PRIMARY_FRACTION);
  for (const name of exercise.secondaryMuscles ?? []) add(name, SECONDARY_FRACTION);

  // `muscleContributionSchema` caps the array at 12.
  return [...byMuscle.entries()]
    .sort(([, left], [, right]) => right - left)
    .slice(0, 12)
    .map(([muscle, fraction]) => ({ muscle, fraction }));
}

function loadKindOf(
  exercise: DatasetExercise,
  equipment: Equipment,
  category: string,
): CatalogueEntry['loadKind'] {
  // Assistance inverts — more of it is an easier set — so getting this wrong makes
  // progress read as regression on the one movement beginners use most.
  if (ASSISTED.test(exercise.name)) return 'assisted';
  if (category === 'stretching' || equipment === 'other') return 'none';
  if (equipment === 'bodyweight') {
    // A plank is unloaded; a pull-up is the lifter's own bodyweight plus whatever they
    // hang off it. Both are `body only` upstream.
    return TIMED.test(exercise.name) ? 'none' : 'bodyweight';
  }
  return 'external';
}

function effortKindOf(exercise: DatasetExercise, category: string): CatalogueEntry['effortKind'] {
  if (DISTANCE.test(exercise.name)) return 'distance';
  if (category === 'cardio') return 'distance';
  if (category === 'stretching' || TIMED.test(exercise.name)) return 'duration';
  return 'reps';
}
