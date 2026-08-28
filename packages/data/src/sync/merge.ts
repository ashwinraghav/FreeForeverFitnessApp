import type { BodyMetric } from '../schemas/body.js';
import type { HabitDay, HabitEntry } from '../schemas/habits.js';
import type {
  Meal,
  NutrientProfile,
  NutritionDay,
} from '../schemas/nutrition.js';
import {
  MAX_ENTRIES_PER_DAY,
  MAX_ENTRIES_PER_MEAL,
  MAX_MEALS_PER_DAY,
} from '../schemas/nutrition.js';
import type { PersonalRecord, PrAchievement, PrType } from '../schemas/records.js';
import { MAX_PR_HISTORY } from '../schemas/records.js';

/**
 * Conflict resolution, per data class.
 *
 * Firestore resolves concurrent writes to one document last-writer-wins, whole
 * document. That is the right answer for some of this domain and the wrong answer
 * for the rest, so the policy is explicit per class rather than inherited from the
 * transport. The full reasoning lives in `SYNC.md`; the operative table:
 *
 * - **Random-id documents** (workouts, routines, custom exercises, foods, recipes,
 *   macro targets, habit definitions): LWW. Two devices editing the *same* workout
 *   concurrently means someone is logging one session on two phones at once — the
 *   realistic concurrent case is two *different* sessions, which are two different
 *   documents and never conflict. For these, losing a rare simultaneous edit is
 *   acceptable; inventing a merged workout nobody performed is not.
 *
 * - **Date-keyed documents** (nutritionDays, habitDays, bodyMetrics): collision is
 *   *by design* — two devices that both logged Tuesday address the same id — so
 *   these get real merges: union of meals/entries by id, field-wise
 *   latest-measurement for body metrics. This is where LWW would eat someone's
 *   lunch, literally.
 *
 * - **Personal records**: a semilattice join — per record type, the higher value
 *   wins; histories union. Joining twice, or in either order, gives the same
 *   document, which is exactly the property an offline-written PR needs.
 *
 * These functions are pure and total: they merge document *bodies* and leave the
 * envelope (`sv`, `uid`, timestamps) for the write layer to stamp.
 */

export type MergeStrategy<T> = (local: T, server: T) => T;

/** LWW with local bias: the user's most recent intent on this device wins. */
export function preferLocal<T>(local: T): T {
  return local;
}

const NUTRIENT_KEYS = [
  'energyKcal',
  'proteinG',
  'carbsG',
  'fatG',
  'fiberG',
  'sugarG',
  'addedSugarG',
  'saturatedFatG',
  'transFatG',
  'monounsaturatedFatG',
  'polyunsaturatedFatG',
  'cholesterolMg',
  'sodiumMg',
  'potassiumMg',
  'calciumMg',
  'ironMg',
  'alcoholG',
] as const;

export function sumNutrientProfiles(profiles: readonly NutrientProfile[]): NutrientProfile {
  const out: Record<string, number> = { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  for (const profile of profiles) {
    for (const key of NUTRIENT_KEYS) {
      const value = profile[key];
      if (value !== undefined) out[key] = (out[key] ?? 0) + value;
    }
  }
  return out as unknown as NutrientProfile;
}

function bySortKey(a: { sortKey: string }, b: { sortKey: string }): number {
  return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
}

function mergeMeal(local: Meal, server: Meal): Meal {
  const entries = new Map(server.entries.map((entry) => [entry.id, entry]));
  for (const entry of local.entries) entries.set(entry.id, entry);
  const merged = [...entries.values()].sort(bySortKey).slice(0, MAX_ENTRIES_PER_MEAL);
  return {
    ...local,
    entries: merged,
    totals: sumNutrientProfiles(merged.map((entry) => entry.nutrients)),
  };
}

/**
 * Union of meals by id, and of entries by id within a shared meal. Totals and
 * entry counts are recomputed from what survived — never summed across the two
 * inputs, which would double-count everything both sides already had.
 */
export const mergeNutritionDays: MergeStrategy<NutritionDay> = (local, server) => {
  const meals = new Map<string, Meal>(server.meals.map((meal) => [meal.id, meal]));
  for (const meal of local.meals) {
    const existing = meals.get(meal.id);
    meals.set(meal.id, existing === undefined ? meal : mergeMeal(meal, existing));
  }
  let merged = [...meals.values()].sort(bySortKey).slice(0, MAX_MEALS_PER_DAY);

  // The day-level entry cap outranks the per-meal one. Trim from the end of the
  // day (last meals lose entries first) only if the union genuinely exceeds it.
  let total = merged.reduce((count, meal) => count + meal.entries.length, 0);
  if (total > MAX_ENTRIES_PER_DAY) {
    merged = merged.map((meal) => ({ ...meal }));
    for (let i = merged.length - 1; i >= 0 && total > MAX_ENTRIES_PER_DAY; i -= 1) {
      const meal = merged[i] as Meal;
      const excess = Math.min(total - MAX_ENTRIES_PER_DAY, meal.entries.length);
      const entries = meal.entries.slice(0, meal.entries.length - excess);
      merged[i] = { ...meal, entries, totals: sumNutrientProfiles(entries.map((e) => e.nutrients)) };
      total -= excess;
    }
  }

  const entryCount = merged.reduce((count, meal) => count + meal.entries.length, 0);
  const base: NutritionDay = {
    ...local,
    meals: merged,
    totals: sumNutrientProfiles(merged.flatMap((meal) => meal.entries.map((e) => e.nutrients))),
    entryCount,
    waterMl: Math.max(local.waterMl, server.waterMl),
  };
  const targetSnapshot = local.targetSnapshot ?? server.targetSnapshot;
  const note = local.note ?? server.note;
  return {
    ...base,
    ...(targetSnapshot !== undefined ? { targetSnapshot } : {}),
    ...(note !== undefined ? { note } : {}),
  };
};

function betterHabitEntry(a: HabitEntry, b: HabitEntry): HabitEntry {
  // An answered entry beats a pending one; two answers resolve to the later tap.
  if (a.status === 'pending' && b.status !== 'pending') return b;
  if (b.status === 'pending' && a.status !== 'pending') return a;
  if ((b.completedAt ?? 0) > (a.completedAt ?? 0)) return b;
  return a;
}

export const mergeHabitDays: MergeStrategy<HabitDay> = (local, server) => {
  const entries = new Map<string, HabitEntry>(
    server.entries.map((entry) => [entry.habitId, entry]),
  );
  for (const entry of local.entries) {
    const existing = entries.get(entry.habitId);
    entries.set(entry.habitId, existing === undefined ? entry : betterHabitEntry(existing, entry));
  }
  const merged = [...entries.values()].sort((a, b) =>
    a.habitId < b.habitId ? -1 : a.habitId > b.habitId ? 1 : 0,
  );
  return { ...local, entries: merged.slice(0, 30) };
};

/**
 * Field-wise: the document with the later `measuredAt` wins each field it
 * actually carries; the earlier one fills in whatever the later left blank.
 * Two scales on one day should not erase the morning's tape measurements.
 */
export const mergeBodyMetrics: MergeStrategy<BodyMetric> = (local, server) => {
  const [base, overlay] = local.measuredAt >= server.measuredAt ? [server, local] : [local, server];
  const measurements =
    base.measurements === undefined && overlay.measurements === undefined
      ? undefined
      : { ...(base.measurements ?? {}), ...(overlay.measurements ?? {}) };
  const merged: BodyMetric = {
    ...base,
    ...definedFieldsOf(overlay),
    // Envelope and identity always come from local; the writer re-stamps them.
    sv: local.sv,
    uid: local.uid,
    id: local.id,
    createdAt: local.createdAt,
    updatedAt: local.updatedAt,
    ...(measurements !== undefined ? { measurements } : {}),
  };
  return merged;
};

function definedFieldsOf<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
}

function achievementKey(a: PrAchievement): string {
  return `${a.type}|${a.achievedAt}|${a.workoutId}|${a.value}`;
}

function betterAchievement(a: PrAchievement, b: PrAchievement): PrAchievement {
  if (b.value > a.value) return b;
  if (a.value > b.value) return a;
  // Same value: the earlier achievement is the record; the later one tied it.
  return a.achievedAt <= b.achievedAt ? a : b;
}

/**
 * Semilattice join: commutative, associative, idempotent. Two devices that each
 * detected a PR offline converge on the union of bests no matter who syncs first
 * or how many times the merge runs.
 */
export const mergePersonalRecords: MergeStrategy<PersonalRecord> = (local, server) => {
  const current: Record<string, PrAchievement> = { ...server.current };
  for (const [type, achievement] of Object.entries(local.current)) {
    const existing = current[type];
    current[type] = existing === undefined ? achievement : betterAchievement(existing, achievement);
  }

  const repMax: Record<string, number> = { ...server.repMaxKgByReps };
  for (const [reps, valueKg] of Object.entries(local.repMaxKgByReps)) {
    const existing = repMax[reps];
    repMax[reps] = existing === undefined ? valueKg : Math.max(existing, valueKg);
  }

  const history = new Map<string, PrAchievement>();
  for (const achievement of [...server.history, ...local.history]) {
    history.set(achievementKey(achievement), achievement);
  }
  const mergedHistory = [...history.values()]
    .sort((a, b) => a.achievedAt - b.achievedAt || (a.type < b.type ? -1 : 1))
    .slice(-MAX_PR_HISTORY);

  const lastAchievedOn =
    local.lastAchievedOn === undefined
      ? server.lastAchievedOn
      : server.lastAchievedOn === undefined
        ? local.lastAchievedOn
        : local.lastAchievedOn >= server.lastAchievedOn
          ? local.lastAchievedOn
          : server.lastAchievedOn;

  return {
    ...local,
    current: current as Partial<Record<PrType, PrAchievement>> as PersonalRecord['current'],
    repMaxKgByReps: repMax as PersonalRecord['repMaxKgByReps'],
    history: mergedHistory,
    ...(lastAchievedOn !== undefined ? { lastAchievedOn } : {}),
  };
};
