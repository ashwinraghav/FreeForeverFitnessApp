import type {
  EffortKind,
  EffortRating,
  EpochMillis,
  ExerciseRef,
  LoadKind,
  LocalDate,
  SetId,
  SetState,
  SetTag,
  SetType,
  SortKey,
  WorkoutExerciseId,
  WorkoutId,
} from '@freeforever/data';

/**
 * The in-progress session, as it exists on the device while the lifter is under a bar.
 *
 * This is deliberately *not* the `Workout` document from `@freeforever/data`. Three
 * differences, each of which matters:
 *
 *   1. **Every entered number is nullable.** `null` is not zero. A set the user has
 *      not filled in yet and a set of zero reps are different facts, and a draft type
 *      that cannot express the first one forces the UI to invent a zero.
 *   2. **There are no server timestamps.** They resolve at commit; the draft never
 *      holds one and so can never accidentally write one (`Draft<T>` in the schema
 *      package exists for the same reason).
 *   3. **There are no totals.** They are derived at finish time by `@freeforever/core`
 *      rather than maintained incrementally, because an incrementally maintained
 *      total drifts and the sets are the truth.
 *
 * What is *not* in here is just as deliberate: **there are no ghost values**. The
 * carried-over numbers from last session are computed at render time from history and
 * live in a separate map (`ghosts.ts`). Keeping them out of the draft makes "a ghost
 * can never be saved as if it were logged data" a property of the type rather than a
 * rule someone has to remember.
 */

export interface DraftSet {
  readonly id: SetId;
  /** Fractional index. See `common/sortKey.ts` — never an integer position. */
  readonly sortKey: SortKey;
  readonly type: SetType;
  readonly state: SetState;
  readonly loadKind: LoadKind;
  readonly effortKind: EffortKind;
  /** Entered load. `null` means nothing entered — not zero. */
  readonly weightKg: number | null;
  /** Entered reps. `null` means nothing entered — not zero. */
  readonly reps: number | null;
  readonly durationSec: number | null;
  readonly distanceM: number | null;
  readonly effortRating?: EffortRating;
  /** Rest actually taken before this set, as measured by the timer. */
  readonly restSecBefore?: number;
  /** Device wall clock. Present if and only if the set has been attempted. */
  readonly performedAt?: EpochMillis;
  readonly tags?: readonly SetTag[];
  readonly note?: string;
}

export interface DraftExercise {
  readonly id: WorkoutExerciseId;
  readonly sortKey: SortKey;
  readonly exercise: ExerciseRef;
  readonly sets: readonly DraftSet[];
  readonly supersetGroup?: string;
  readonly targetRestSec?: number;
  readonly note?: string;
}

export interface DraftWorkout {
  readonly id: WorkoutId;
  readonly status: 'in_progress' | 'completed' | 'discarded';
  readonly title: string;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly localDate: LocalDate;
  readonly tzOffsetMinutes: number;
  readonly exercises: readonly DraftExercise[];
  readonly bodyweightKg?: number;
  readonly note?: string;
  readonly sessionRpe?: number;
}

/**
 * Something the user removed, kept so it can be put straight back.
 *
 * Removal is the one action here that destroys entered data, and there are no modals
 * in the workout flow to confirm it (CLAUDE.md). The answer is not a dialog, it is an
 * undo: the removed thing stays in memory and a toast offers it back. Nothing is
 * gone until the session is written.
 */
export type Removal =
  | { readonly kind: 'exercise'; readonly exercise: DraftExercise; readonly label: string }
  | {
      readonly kind: 'set';
      readonly exerciseId: WorkoutExerciseId;
      readonly set: DraftSet;
      readonly label: string;
    };

export interface WorkoutState {
  readonly workout: DraftWorkout;
  /** Most recent first. Bounded — see MAX_UNDO in `session.ts`. */
  readonly undoStack: readonly Removal[];
}
