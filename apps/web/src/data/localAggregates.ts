import type { DomainSnapshot, LocalDate, Workout } from '@freeforever/data';
import { REDUCERS } from '@freeforever/data/sync';
import type { CompletedSession } from '../features/workout/model/history';
import type { InsightsSnapshot } from '../features/insights/data/ports';
import { derivePersonalRecords } from './personalRecords';
import { toWorkoutDocument } from './workoutDocuments';

/**
 * Folding what is on the device into what the Progress tab draws.
 *
 * ADR-0005 in practice: nothing here touches the network, and there is no query
 * surface to reach for. The device holds finished sessions; the sync team's reducers
 * turn documents into aggregates; this joins the two and hands the result to the
 * insights port.
 *
 * **`rebuild`, not `reduce`.** The reducers offer both, and the incremental path is
 * the one that matters when a listener is streaming deltas. There is no listener
 * here — the whole corpus is a bounded array in `localStorage`, capped at
 * `MAX_LOCAL_HISTORY` sessions — so a full rebuild is a few milliseconds over at most
 * sixty documents, and it has no sequence state to get wrong. `reduce === rebuild` is
 * proven bit-exact by the sync team's property test, so taking the simpler of the two
 * costs nothing and removes every ordering bug this layer could have had.
 *
 * ## A bundle-size defect that is not this file's to fix
 *
 * `REDUCERS` is five pure folds with no dependencies beyond the schema package. It is
 * imported here through `@freeforever/data/sync`, whose barrel also re-exports
 * `firebase.js` — so the whole Firebase SDK lands in the Progress chunk: **490 kB
 * against 62 kB**, 132 kB gzipped against 20 kB, for code this tab never calls.
 * Rollup cannot drop it, because Firebase is a bare dependency with no
 * `sideEffects: false` to license the removal.
 *
 * The package's `exports` map offers `.` and `./sync` and nothing narrower, so there
 * is no import that reaches the registry without the barrel. Deep-importing the file
 * by relative path fixes the bytes exactly — measured — and fails `tsc -b`, because
 * the file then sits outside `apps/web`'s `rootDir`.
 *
 * The fix is one line in `packages/data/package.json`, which is domain-model's file:
 *
 *     "./sync/reducers": "./src/sync/reducers/registry.ts"
 *
 * after which the import above becomes `@freeforever/data/sync/reducers` and nothing
 * else changes. Reported to the integrator. Free-forever rule 2 counts bytes, and
 * this is 112 kB gzipped of them — off the critical path, since the tab is lazy and
 * the app opens on Train, but paid by every user who taps Progress once.
 */

/** Which parts of a `DomainSnapshot` a device with no sync engine can actually fill. */
export interface LocalSources {
  readonly sessions: readonly CompletedSession[];
  readonly timeZone: string;
}

/**
 * A `DomainSnapshot` from device-local data.
 *
 * Five of the eight collections are empty and each one is empty for a reason, not by
 * omission:
 *
 * - `routines` — the workout feature has no routine builder yet, so nothing writes
 *   one. No reducer reads this collection anyway.
 * - `bodyMetrics` — no local writer and, per `insights/data/proposed.ts`, no reducer
 *   either. The body screens stay on their empty state.
 * - `nutritionDays` / `macroTargets` — the nutrition feature does hold both, under
 *   its own `ff:nutrition:v1` key. They are left out because `InsightsSnapshot` has
 *   no nutrition field: the port exposes four aggregates plus the proposed body one,
 *   and none of them is `nutrition`. Folding it would produce a value with nowhere to
 *   put it. See the note in the module below.
 * - `habits` / `habitDays` — no habit feature exists, so `habitStreaks` stays empty.
 *   Training streaks come from sessions and are unaffected.
 */
export function domainSnapshotOf({ sessions, timeZone }: LocalSources): DomainSnapshot {
  const workouts: Workout[] = sessions.map(toWorkoutDocument);
  return {
    workouts,
    routines: [],
    personalRecords: derivePersonalRecords(workouts),
    bodyMetrics: [],
    nutritionDays: [],
    macroTargets: [],
    habits: [],
    habitDays: [],
    timeZone,
  };
}

export interface AggregateInputs extends LocalSources {
  readonly today: LocalDate;
  readonly units: InsightsSnapshot['units'];
}

/**
 * The whole Progress tab, as one value.
 *
 * `bodyMetrics` is null because there is no body-metrics reducer to produce one — a
 * declared gap in `insights/data/proposed.ts`, not something this layer can close by
 * inventing a shape. Null is the port's first-class "not materialised" state and the
 * body screens render it as such.
 */
export function insightsSnapshotOf(inputs: AggregateInputs): InsightsSnapshot {
  const snapshot = domainSnapshotOf(inputs);
  return {
    trainingVolume: REDUCERS.training_volume.rebuild(snapshot),
    exerciseProgress: REDUCERS.exercise_progress.rebuild(snapshot),
    personalRecords: REDUCERS.personal_records.rebuild(snapshot),
    adherence: REDUCERS.adherence.rebuild(snapshot),
    bodyMetrics: null,
    today: inputs.today,
    timeZone: inputs.timeZone,
    units: inputs.units,
    rebuilding: false,
  };
}
