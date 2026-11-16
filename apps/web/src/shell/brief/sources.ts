import { DEFAULT_UNIT_PREFERENCES, type UnitPreferences } from '@freeforever/data';
import { planWeeklyTargets, targetForDate } from '@freeforever/core/src/nutrition/index.js';
import type { MacroTargetValues } from '@freeforever/core/src/nutrition/index.js';
import type { NutritionDay, TargetPlan } from '../../features/nutrition/data/types';
import { createLocalStore } from '../../features/nutrition/data/store';
import { localWorkoutRepository } from '../../features/workout/storage/workoutStore';
import { insightsSnapshotOf } from '../../data/localAggregates';
import { todayLocalDate } from '../../data/insightsSource';
import { buildBrief, type BriefInputs } from './brief';

/**
 * The impure half: read the device, hand `buildBrief` a value.
 *
 * ## Import this lazily, always
 *
 * `insightsSnapshotOf` pulls in `REDUCERS` from `@freeforever/data/sync`, whose barrel
 * also re-exports `firebase.js` — 490 kB parsed, 132 kB gzipped, for five pure folds.
 * That defect is documented at length in `../../data/localAggregates.ts` and the
 * one-line fix belongs to the domain-model team's `package.json`, not here.
 *
 * Until it lands, this module must never be reachable from the shell's main chunk.
 * More is not code-split — it is the first screen a new user sees (`firstRun.ts`) — so
 * a static import here would put the whole Firebase SDK in front of everybody, to
 * serve a text file most of them will never generate. Every caller therefore reaches
 * it through `await import('./brief/sources')`, and the `/brief` route is `lazy()`.
 *
 * ## Why it reads the aggregates rather than the sessions twice
 *
 * The volume, bests and streak numbers in the brief have to be the same numbers the
 * Progress tab draws, or the brief becomes a second opinion about the user's own
 * training. Reusing the reducers is what guarantees that; recomputing tonnage here
 * would be a copy of the arithmetic that could drift silently.
 */

export interface BriefSourceOptions {
  /** Fixed in tests. The one clock read in this module. */
  readonly now?: () => Date;
  readonly timeZone?: string;
  readonly units?: UnitPreferences;
}

export function readBriefInputs(options: BriefSourceOptions = {}): BriefInputs {
  const now = (options.now ?? (() => new Date()))();
  const sessions = localWorkoutRepository.loadHistory();
  const snapshot = insightsSnapshotOf({
    sessions,
    timeZone: options.timeZone ?? deviceTimeZone(),
    today: todayLocalDate(now),
    units: options.units ?? DEFAULT_UNIT_PREFERENCES,
  });

  const nutrition = createLocalStore().load();
  const nutritionDays = Object.values(nutrition.days);

  return {
    sessions,
    volume: snapshot.trainingVolume,
    records: snapshot.personalRecords,
    adherence: snapshot.adherence,
    nutritionDays,
    nutritionTargets: targetsByDate(nutrition.target, nutritionDays),
    today: snapshot.today,
    timeZone: snapshot.timeZone,
    generatedAt: now,
  };
}

/**
 * The target in force on each logged day.
 *
 * Through `planWeeklyTargets` and `targetForDate` rather than reading `plan.base`,
 * because a plan may cycle calories across the week — higher on training days, lower
 * otherwise, same weekly total. `plan.base` is the input to that calculation and not
 * the number in force on a Tuesday, so quoting it would put a figure in the brief that
 * the Eat tab never showed anybody. Same rule as the training aggregates: the brief
 * reuses the app's own arithmetic instead of keeping a second opinion.
 */
function targetsByDate(
  plan: TargetPlan | null,
  days: readonly NutritionDay[],
): Record<string, MacroTargetValues> {
  if (plan === null) return {};
  const week = planWeeklyTargets({
    base: plan.base,
    plan: { trainingDays: plan.trainingDays as never, swingFraction: plan.swingFraction },
    energyFloorKcal: plan.energyFloorKcal,
  });
  const byDate: Record<string, MacroTargetValues> = {};
  for (const day of days) byDate[day.localDate] = targetForDate(week.days, day.localDate);
  return byDate;
}

/** The brief for this device, right now. */
export function briefForThisDevice(options: BriefSourceOptions = {}): string {
  return buildBrief(readBriefInputs(options));
}

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    // Throws in some locked-down contexts, and a missing timezone must not cost
    // the user their brief — it is one line of a header.
    return 'UTC';
  }
}
