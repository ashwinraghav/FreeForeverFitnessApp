import type {
  EffortKind,
  Equipment,
  ExerciseId,
  ExerciseRef,
  LoadKind,
  MuscleContribution,
} from '@freeforever/data';

/**
 * The on-device exercise catalogue.
 *
 * The catalogue ships with the app rather than living in Firestore (ADR-0006): search
 * is the highest-frequency read in the picker, and answering it from the server would
 * turn the core interaction into a recurring per-user cost. It is also the only way
 * the picker works in a basement with no signal.
 *
 * **Note for the integrator.** `@freeforever/datasets` already builds a real 873-entry
 * catalogue (`build/exercises.json.gz`), but it is not a dependency of `@freeforever/web`
 * and installs are yours to run. So this feature ships a hand-written starter set
 * behind the {@link CatalogueEntry} shape and searches that. Adding the dependency and
 * writing one adapter from `datasets`' `Exercise` to this type swaps the data over
 * with no change to the picker, the search or their tests — that is why the boundary
 * is a type rather than a direct import.
 */

export interface CatalogueEntry {
  readonly id: ExerciseId;
  readonly name: string;
  /** Gym shorthand: "ohp", "rdl", "bb squat". Searched alongside the name. */
  readonly aliases: readonly string[];
  readonly equipment: Equipment;
  readonly loadKind: LoadKind;
  readonly effortKind: EffortKind;
  /** Ordered most-primary first. Fractions, never all-1.0 — see `MuscleContribution`. */
  readonly muscles: readonly MuscleContribution[];
  /** True when left and right are loaded separately, so volume counts both limbs. */
  readonly unilateral: boolean;
  /** Empty bar or carriage mass, when the lifter logs plates rather than the total. */
  readonly implementMassKg?: number;
}

/**
 * Freeze what a logged set points at.
 *
 * The name and the muscle split are copied in deliberately (SCHEMA.md): history has
 * to render offline from one document, and a catalogue rebuilt six months from now
 * must not be able to rewrite what a lifter's log says they did.
 */
export function toExerciseRef(entry: CatalogueEntry): ExerciseRef {
  return {
    source: 'catalogue',
    exerciseId: entry.id,
    name: entry.name,
    loadKind: entry.loadKind,
    effortKind: entry.effortKind,
    muscles: [...entry.muscles],
    unilateral: entry.unilateral,
  };
}
