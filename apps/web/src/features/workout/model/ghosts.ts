import type { SetId } from '@freeforever/data';

import { orderedSets } from './session.js';
import type { CompletedSession, ExerciseHistoryEntry } from './history.js';
import { lastTimeFor } from './history.js';
import type { DraftExercise, DraftSet, DraftWorkout } from './types.js';

/**
 * Ghost values — the single highest-leverage thing on the screen.
 *
 * Most sets repeat the last one. If the row arrives pre-filled with last session's
 * numbers, logging a set is one tap instead of four; if it arrives empty, the lifter
 * types four digits with chalky hands, out of breath, between sets, forty times a
 * session. That is the whole difference between a log people keep and a log people
 * abandon in week three.
 *
 * Two properties make this safe rather than dangerous:
 *
 *   1. **A ghost is derived, never stored.** It is computed here from history and
 *      handed to the row as a prop. `DraftSet` has no field for it. So a ghost cannot
 *      be written to a document, cannot be counted in a total, and cannot survive a
 *      reload as if it were data — not by discipline, but because there is nowhere
 *      for it to live.
 *   2. **A ghost only becomes data on an explicit act.** The lifter tapping the log
 *      button is that act, and the reducer commits the ghost at exactly that moment
 *      (`commitInto` in `session.ts`). Nothing else promotes it.
 *
 * `NumberField` renders the value muted, lighter and dashed-underlined, so the
 * difference between "60kg last week" and "60kg today" survives bad light, greyscale
 * and a colour-vision deficiency — never colour alone (ADR-0013).
 */

export interface GhostValues {
  readonly weightKg: number | null;
  readonly reps: number | null;
  readonly durationSec: number | null;
  readonly distanceM: number | null;
}

/** Ghosts for one exercise's sets, keyed by the set they belong to. */
export type GhostMap = ReadonlyMap<SetId, GhostValues>;

const EMPTY: GhostMap = new Map();

/**
 * Match this exercise's sets against the same exercise's sets last time, by position.
 *
 * Positional matching, not "the heaviest" or "the average": the third set of five is
 * compared with the third set of five, so a top-set-and-backoffs session carries over
 * correctly instead of prefilling every row with the top set. Warmups are matched
 * against warmups for the same reason.
 *
 * Where this session has more sets than last, the extra rows inherit the *last*
 * previous set of their type — the natural reading of "another one like that".
 */
export function ghostsForExercise(
  exercise: DraftExercise,
  sessions: readonly CompletedSession[],
): GhostMap {
  const previous = lastTimeFor(exercise.exercise, sessions);
  if (previous === null) return EMPTY;
  return ghostsFromEntry(exercise, previous);
}

/** The same match against an already-resolved history entry, for callers that hold one. */
export function ghostsFromEntry(
  exercise: DraftExercise,
  previous: ExerciseHistoryEntry,
): GhostMap {
  const ghosts = new Map<SetId, GhostValues>();
  const cursors = { warmup: 0, working: 0 };

  for (const set of orderedSets(exercise)) {
    // Warmups match against warmups and working sets against working sets. A ramp-up
    // of 20/60/80 followed by three at 100 must not carry the 20kg bar warmup over
    // onto the first working row.
    const lane = set.type === 'warmup' ? previous.warmupSets : previous.sets;
    const cursorKey = set.type === 'warmup' ? 'warmup' : 'working';
    // Past the end of last session's list, every extra row inherits the last one —
    // the natural reading of "and another one like that".
    const source = lane[cursors[cursorKey]] ?? lane[lane.length - 1];
    cursors[cursorKey] += 1;
    if (source === undefined) continue;
    ghosts.set(set.id, {
      weightKg: source.weightKg,
      reps: source.reps,
      durationSec: source.durationSec,
      distanceM: source.distanceM,
    });
  }

  return ghosts;
}

/** Ghosts for every exercise in the session, keyed by set id across the whole workout. */
export function ghostsForWorkout(
  workout: DraftWorkout,
  sessions: readonly CompletedSession[],
): GhostMap {
  const all = new Map<SetId, GhostValues>();
  for (const exercise of workout.exercises) {
    for (const [setId, values] of ghostsForExercise(exercise, sessions)) {
      all.set(setId, values);
    }
  }
  return all;
}

/**
 * What the row should display for a field: the entered value, or the ghost, or
 * nothing — and which of the three it is.
 *
 * The caller needs the discriminator, not just the number. A row that renders 60 with
 * no way to tell whether the lifter typed it is the failure this whole design is
 * guarding against.
 */
export type CellSource = 'entered' | 'ghost' | 'empty';

export interface Cell {
  readonly value: number | null;
  readonly source: CellSource;
}

export function cellFor(
  entered: number | null,
  ghost: number | null | undefined,
): Cell {
  if (entered !== null) return { value: entered, source: 'entered' };
  if (ghost !== null && ghost !== undefined) return { value: ghost, source: 'ghost' };
  return { value: null, source: 'empty' };
}

/**
 * The values the log button should commit for a set, given what is on screen.
 *
 * Returns only the fields the lifter left empty — a typed value is never overwritten
 * — and only the fields this exercise actually measures, so a plank never acquires a
 * phantom rep count from a ghost.
 */
export function commitValuesFor(
  set: DraftSet,
  ghost: GhostValues | undefined,
): { weightKg?: number; reps?: number; durationSec?: number; distanceM?: number } {
  if (ghost === undefined) return {};
  const commit: { weightKg?: number; reps?: number; durationSec?: number; distanceM?: number } = {};

  if (set.loadKind !== 'none' && set.weightKg === null && ghost.weightKg !== null) {
    commit.weightKg = ghost.weightKg;
  }
  const measuresReps = set.effortKind === 'reps' || set.effortKind === 'reps_and_duration';
  if (measuresReps && set.reps === null && ghost.reps !== null) {
    commit.reps = ghost.reps;
  }
  const measuresTime =
    set.effortKind === 'duration' ||
    set.effortKind === 'reps_and_duration' ||
    set.effortKind === 'distance';
  if (measuresTime && set.durationSec === null && ghost.durationSec !== null) {
    commit.durationSec = ghost.durationSec;
  }
  if (set.effortKind === 'distance' && set.distanceM === null && ghost.distanceM !== null) {
    commit.distanceM = ghost.distanceM;
  }

  return commit;
}

/**
 * Whether a set has enough entered or ghosted to be worth logging in one tap.
 *
 * A row with neither a typed value nor a ghost would log an empty set, which is worse
 * than nothing: it is a lie in the history that then becomes next week's ghost.
 */
export function isLoggableInOneTap(set: DraftSet, ghost: GhostValues | undefined): boolean {
  const cell = (entered: number | null, ghosted: number | null | undefined) =>
    entered !== null || (ghosted !== null && ghosted !== undefined);

  switch (set.effortKind) {
    case 'reps':
    case 'reps_and_duration':
      return cell(set.reps, ghost?.reps);
    case 'duration':
      return cell(set.durationSec, ghost?.durationSec);
    case 'distance':
      return cell(set.distanceM, ghost?.distanceM);
  }
}
