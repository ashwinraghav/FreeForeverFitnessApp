import {
  computePortionNutrition,
  MAX_ENTRIES_PER_DAY,
  MAX_ENTRIES_PER_MEAL,
  MAX_MEALS_PER_DAY,
  rollUpDay,
  rollUpMeal,
  toStorageResolution,
  type MealSlot,
  type NutrientProfile,
  type Serving,
} from '@freeforever/core/src/nutrition/index.js';
import { sortKeyAfter, type SortKey } from '@freeforever/data';
import {
  MAX_RECENTS,
  type CustomFood,
  type FoodKey,
  type FoodSnapshot,
  type LocalDate,
  type LogEntry,
  type Meal,
  type NutritionDay,
  type NutritionState,
  type RecentFood,
  type SavedMeal,
} from './types.js';

/**
 * Log reducers. Pure functions from state and a command to new state.
 *
 * Every command carries its own `id` and `now` rather than generating them, so
 * the whole logging surface is deterministic and testable without faking a
 * clock or a UUID source. The UI supplies both at the call site.
 *
 * Totals are recomputed by summing stored entry values on every write, so
 * `day.totals === Σ meal.totals === Σ entry.nutrients` holds by construction
 * rather than by discipline.
 */

const ORDER: readonly MealSlot[] = [
  'breakfast',
  'lunch',
  'snack',
  'pre_workout',
  'post_workout',
  'dinner',
  'other',
];

export function emptyDay(localDate: LocalDate, tzOffsetMinutes: number): NutritionDay {
  return {
    localDate,
    tzOffsetMinutes,
    meals: [],
    totals: { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    entryCount: 0,
    waterMl: 0,
  };
}

export function dayOf(state: NutritionState, date: LocalDate): NutritionDay | undefined {
  return state.days[date];
}

/** Recompute a meal's denormalised totals from its entries. */
export function recomputeMeal(meal: Meal): Meal {
  return { ...meal, totals: rollUpMeal(meal.entries) };
}

/** Recompute a day's denormalised totals from its meals, and re-sort the meals. */
export function recomputeDay(day: NutritionDay): NutritionDay {
  const meals = [...day.meals].sort(
    (a, b) => ORDER.indexOf(a.slot) - ORDER.indexOf(b.slot) || a.sortKey.localeCompare(b.sortKey),
  );
  const { totals, entryCount } = rollUpDay(meals);
  return { ...day, meals, totals, entryCount };
}

function upsertDay(state: NutritionState, day: NutritionDay): NutritionState {
  return { ...state, days: { ...state.days, [day.localDate]: recomputeDay(day) } };
}

function lastSortKey(keys: readonly string[]): SortKey | null {
  const sorted = [...keys].sort();
  return (sorted[sorted.length - 1] as SortKey | undefined) ?? null;
}

/* ── Caps ────────────────────────────────────────────────────────────────── */

export type LogRejection = 'day_entry_cap' | 'meal_entry_cap' | 'meal_cap';

/**
 * Whether one more entry fits, and why not if it does not.
 *
 * The caps come from the schema (`MAX_ENTRIES_PER_DAY` and friends), and are
 * checked here rather than at the sync boundary so the user is told before they
 * type, not after the write is rejected.
 */
export function checkCapacity(
  state: NutritionState,
  date: LocalDate,
  slot: MealSlot,
  adding = 1,
): LogRejection | null {
  const day = state.days[date];
  if (!day) return null;
  if (day.entryCount + adding > MAX_ENTRIES_PER_DAY) return 'day_entry_cap';
  const meal = day.meals.find((m) => m.slot === slot);
  if (meal && meal.entries.length + adding > MAX_ENTRIES_PER_MEAL) return 'meal_entry_cap';
  if (!meal && day.meals.length + 1 > MAX_MEALS_PER_DAY) return 'meal_cap';
  return null;
}

/* ── Logging ─────────────────────────────────────────────────────────────── */

export interface LogFoodCommand {
  date: LocalDate;
  tzOffsetMinutes: number;
  slot: MealSlot;
  snapshot: FoodSnapshot;
  quantity: number;
  serving: Serving;
  /** Client-generated. Carried in the command so the reducer stays pure. */
  entryId: string;
  now: number;
  note?: string;
}

/**
 * Log one food into one meal.
 *
 * Also updates recents, because the recents list is not a view over the log —
 * it is its own denormalised structure carrying the portion and meal the user
 * chose. Deriving it from the log would mean walking every day document to
 * render the shortcut that exists to avoid work.
 */
export function logFood(state: NutritionState, cmd: LogFoodCommand): NutritionState {
  if (checkCapacity(state, cmd.date, cmd.slot) !== null) return state;

  const portion = computePortionNutrition({
    nutrientsPer100g: cmd.snapshot.nutrientsPer100g,
    quantity: cmd.quantity,
    serving: cmd.serving,
  });

  const day = state.days[cmd.date] ?? emptyDay(cmd.date, cmd.tzOffsetMinutes);
  const existing = day.meals.find((m) => m.slot === cmd.slot);

  const entry: LogEntry = {
    id: cmd.entryId,
    sortKey: sortKeyAfter(lastSortKey(existing?.entries.map((e) => e.sortKey) ?? [])),
    food: cmd.snapshot.ref,
    quantity: cmd.quantity,
    serving: cmd.serving,
    massG: portion.massG,
    nutrients: portion.nutrients,
    loggedAt: cmd.now,
    ...(cmd.note !== undefined ? { note: cmd.note } : {}),
  };

  const meals = existing
    ? day.meals.map((m) => (m.slot === cmd.slot ? recomputeMeal({ ...m, entries: [...m.entries, entry] }) : m))
    : [
        ...day.meals,
        recomputeMeal({
          id: `${cmd.date}:${cmd.slot}`,
          sortKey: sortKeyAfter(lastSortKey(day.meals.map((m) => m.sortKey))),
          slot: cmd.slot,
          entries: [entry],
          totals: { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
        }),
      ];

  return {
    ...upsertDay(state, { ...day, meals }),
    recents: touchRecent(state.recents, {
      snapshot: cmd.snapshot,
      quantity: cmd.quantity,
      serving: cmd.serving,
      slot: cmd.slot,
      now: cmd.now,
    }),
  };
}

/**
 * Log a food again with the portion and meal the user chose last time.
 *
 * This is the two-tap path, and it is a single pure call precisely because the
 * recent entry already carries everything: nutrients, serving, quantity, slot.
 * No index lookup, no fetch, nothing that can be slow or absent.
 */
export function logAgain(
  state: NutritionState,
  cmd: { key: FoodKey; date: LocalDate; tzOffsetMinutes: number; entryId: string; now: number; slot?: MealSlot },
): NutritionState {
  const recent = state.recents.find((r) => r.snapshot.key === cmd.key);
  if (!recent) return state;
  return logFood(state, {
    date: cmd.date,
    tzOffsetMinutes: cmd.tzOffsetMinutes,
    slot: cmd.slot ?? recent.lastSlot,
    snapshot: recent.snapshot,
    quantity: recent.lastQuantity,
    serving: recent.lastServing,
    entryId: cmd.entryId,
    now: cmd.now,
  });
}

/**
 * Log bare macros with no food behind them.
 *
 * The escape hatch that keeps the log honest: a restaurant meal nobody can
 * itemise gets recorded as what the user knows, rather than abandoned or faked
 * with a food that is not what they ate.
 */
export function quickAdd(
  state: NutritionState,
  cmd: {
    date: LocalDate;
    tzOffsetMinutes: number;
    slot: MealSlot;
    nutrients: NutrientProfile;
    name?: string;
    entryId: string;
    now: number;
  },
): NutritionState {
  if (checkCapacity(state, cmd.date, cmd.slot) !== null) return state;

  const day = state.days[cmd.date] ?? emptyDay(cmd.date, cmd.tzOffsetMinutes);
  const existing = day.meals.find((m) => m.slot === cmd.slot);
  const name = cmd.name?.trim() !== undefined && cmd.name.trim() !== '' ? cmd.name.trim() : 'Quick add';

  const entry: LogEntry = {
    id: cmd.entryId,
    sortKey: sortKeyAfter(lastSortKey(existing?.entries.map((e) => e.sortKey) ?? [])),
    food: { source: 'custom', foodId: `quick:${cmd.entryId}`, name },
    quantity: 1,
    // A quick add has no real portion. It is one serving of itself, of the mass
    // it claims, which keeps every downstream calculation well-defined.
    serving: { name: 'entry', gramsPerServing: 100 },
    massG: 100,
    nutrients: toStorageResolution(cmd.nutrients),
    loggedAt: cmd.now,
  };

  const meals = existing
    ? day.meals.map((m) => (m.slot === cmd.slot ? recomputeMeal({ ...m, entries: [...m.entries, entry] }) : m))
    : [
        ...day.meals,
        recomputeMeal({
          id: `${cmd.date}:${cmd.slot}`,
          sortKey: sortKeyAfter(lastSortKey(day.meals.map((m) => m.sortKey))),
          slot: cmd.slot,
          entries: [entry],
          totals: { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
        }),
      ];

  return upsertDay(state, { ...day, meals });
}

/** Remove one entry. Used by swipe-to-delete and by the undo on the log toast. */
export function removeEntry(
  state: NutritionState,
  cmd: { date: LocalDate; entryId: string },
): NutritionState {
  const day = state.days[cmd.date];
  if (!day) return state;
  const meals = day.meals
    .map((m) => recomputeMeal({ ...m, entries: m.entries.filter((e) => e.id !== cmd.entryId) }))
    // An emptied meal disappears rather than lingering as a zero row.
    .filter((m) => m.entries.length > 0);
  return upsertDay(state, { ...day, meals });
}

/**
 * Change how much of a logged food was eaten.
 *
 * Re-derives from the entry's own serving and the snapshot's per-100 g profile
 * rather than scaling the stored absolute numbers, so twelve taps of `+` land
 * exactly where typing 12 lands.
 */
export function setEntryQuantity(
  state: NutritionState,
  cmd: { date: LocalDate; entryId: string; quantity: number; nutrientsPer100g: NutrientProfile; serving?: Serving },
): NutritionState {
  const day = state.days[cmd.date];
  if (!day) return state;
  if (!Number.isFinite(cmd.quantity) || cmd.quantity < 0) return state;

  const meals = day.meals.map((m) =>
    recomputeMeal({
      ...m,
      entries: m.entries.map((e) => {
        if (e.id !== cmd.entryId) return e;
        const serving = cmd.serving ?? e.serving;
        const portion = computePortionNutrition({
          nutrientsPer100g: cmd.nutrientsPer100g,
          quantity: cmd.quantity,
          serving,
        });
        return { ...e, quantity: cmd.quantity, serving, massG: portion.massG, nutrients: portion.nutrients };
      }),
    }),
  );
  return upsertDay(state, { ...day, meals });
}

/** Move an entry between meals without re-entering it. */
export function moveEntry(
  state: NutritionState,
  cmd: { date: LocalDate; entryId: string; toSlot: MealSlot },
): NutritionState {
  const day = state.days[cmd.date];
  if (!day) return state;
  const entry = day.meals.flatMap((m) => m.entries).find((e) => e.id === cmd.entryId);
  if (!entry) return state;
  const removed = removeEntry(state, cmd).days[cmd.date];
  if (!removed) return state;

  const target = removed.meals.find((m) => m.slot === cmd.toSlot);
  const moved: LogEntry = {
    ...entry,
    sortKey: sortKeyAfter(lastSortKey(target?.entries.map((e) => e.sortKey) ?? [])),
  };
  const meals = target
    ? removed.meals.map((m) => (m.slot === cmd.toSlot ? recomputeMeal({ ...m, entries: [...m.entries, moved] }) : m))
    : [
        ...removed.meals,
        recomputeMeal({
          id: `${cmd.date}:${cmd.toSlot}`,
          sortKey: sortKeyAfter(lastSortKey(removed.meals.map((m) => m.sortKey))),
          slot: cmd.toSlot,
          entries: [moved],
          totals: { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
        }),
      ];
  return upsertDay(state, { ...removed, meals });
}

/* ── Meal reuse ──────────────────────────────────────────────────────────── */

/**
 * Copy a whole meal from one day to another — "same lunch as yesterday".
 *
 * The entries are copied with their own absolute nutrients intact, not
 * re-resolved through the index, so a meal reused six months later reproduces
 * exactly what was eaten rather than what the current index says about it.
 */
export function copyMeal(
  state: NutritionState,
  cmd: {
    fromDate: LocalDate;
    fromSlot: MealSlot;
    toDate: LocalDate;
    toSlot: MealSlot;
    tzOffsetMinutes: number;
    entryIds: string[];
    now: number;
  },
): NutritionState {
  const source = state.days[cmd.fromDate]?.meals.find((m) => m.slot === cmd.fromSlot);
  if (!source || source.entries.length === 0) return state;
  if (checkCapacity(state, cmd.toDate, cmd.toSlot, source.entries.length) !== null) return state;
  if (cmd.entryIds.length < source.entries.length) return state;

  const day = state.days[cmd.toDate] ?? emptyDay(cmd.toDate, cmd.tzOffsetMinutes);
  const target = day.meals.find((m) => m.slot === cmd.toSlot);
  let key = lastSortKey(target?.entries.map((e) => e.sortKey) ?? []);

  const copies = source.entries.map((e, i) => {
    key = sortKeyAfter(key);
    return { ...e, id: cmd.entryIds[i] ?? `${cmd.now}-${i}`, sortKey: key, loggedAt: cmd.now };
  });

  const meals = target
    ? day.meals.map((m) => (m.slot === cmd.toSlot ? recomputeMeal({ ...m, entries: [...m.entries, ...copies] }) : m))
    : [
        ...day.meals,
        recomputeMeal({
          id: `${cmd.toDate}:${cmd.toSlot}`,
          sortKey: sortKeyAfter(lastSortKey(day.meals.map((m) => m.sortKey))),
          slot: cmd.toSlot,
          entries: copies,
          totals: { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
        }),
      ];

  return upsertDay(state, { ...day, meals });
}

/** Save a meal as a reusable template. */
export function saveMealTemplate(
  state: NutritionState,
  cmd: { date: LocalDate; slot: MealSlot; name: string; id: string; now: number },
): NutritionState {
  const meal = state.days[cmd.date]?.meals.find((m) => m.slot === cmd.slot);
  if (!meal || meal.entries.length === 0) return state;

  const saved: SavedMeal = {
    id: cmd.id,
    name: cmd.name.trim() === '' ? cmd.slot : cmd.name.trim(),
    slot: cmd.slot,
    entries: meal.entries.map(({ id: _id, loggedAt: _loggedAt, sortKey: _sortKey, ...rest }) => rest),
    totals: meal.totals,
    createdAt: cmd.now,
  };
  return { ...state, savedMeals: [saved, ...state.savedMeals.filter((m) => m.id !== cmd.id)] };
}

/** Log a saved meal in one action. */
export function logSavedMeal(
  state: NutritionState,
  cmd: {
    savedMealId: string;
    date: LocalDate;
    tzOffsetMinutes: number;
    slot?: MealSlot;
    entryIds: string[];
    now: number;
  },
): NutritionState {
  const saved = state.savedMeals.find((m) => m.id === cmd.savedMealId);
  if (!saved) return state;
  const slot = cmd.slot ?? saved.slot;
  if (checkCapacity(state, cmd.date, slot, saved.entries.length) !== null) return state;
  if (cmd.entryIds.length < saved.entries.length) return state;

  const day = state.days[cmd.date] ?? emptyDay(cmd.date, cmd.tzOffsetMinutes);
  const target = day.meals.find((m) => m.slot === slot);
  let key = lastSortKey(target?.entries.map((e) => e.sortKey) ?? []);

  const entries = saved.entries.map((e, i) => {
    key = sortKeyAfter(key);
    return { ...e, id: cmd.entryIds[i] ?? `${cmd.now}-${i}`, sortKey: key, loggedAt: cmd.now };
  });

  const meals = target
    ? day.meals.map((m) => (m.slot === slot ? recomputeMeal({ ...m, entries: [...m.entries, ...entries] }) : m))
    : [
        ...day.meals,
        recomputeMeal({
          id: `${cmd.date}:${slot}`,
          sortKey: sortKeyAfter(lastSortKey(day.meals.map((m) => m.sortKey))),
          slot,
          entries,
          totals: { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
        }),
      ];

  return upsertDay(state, { ...day, meals });
}

/* ── Water ───────────────────────────────────────────────────────────────── */

export function addWater(
  state: NutritionState,
  cmd: { date: LocalDate; tzOffsetMinutes: number; millilitres: number },
): NutritionState {
  const day = state.days[cmd.date] ?? emptyDay(cmd.date, cmd.tzOffsetMinutes);
  return upsertDay(state, { ...day, waterMl: Math.max(0, day.waterMl + cmd.millilitres) });
}

/* ── Recents and favourites ──────────────────────────────────────────────── */

/**
 * Record that a food was logged, updating its remembered portion and meal.
 *
 * The list is capped and the least useful entry is dropped, ranked by the same
 * frecency the UI orders by — so the food that falls off is the one the user
 * was least likely to want, not merely the oldest.
 */
export function touchRecent(
  recents: readonly RecentFood[],
  input: { snapshot: FoodSnapshot; quantity: number; serving: Serving; slot: MealSlot; now: number },
): RecentFood[] {
  const key = input.snapshot.key;
  const previous = recents.find((r) => r.snapshot.key === key);
  const updated: RecentFood = {
    // Refresh the snapshot: a custom food the user edited must not keep logging
    // its old nutrients from a stale recents row.
    snapshot: input.snapshot,
    lastQuantity: input.quantity,
    lastServing: input.serving,
    lastSlot: input.slot,
    logCount: (previous?.logCount ?? 0) + 1,
    lastLoggedAt: input.now,
  };
  const rest = recents.filter((r) => r.snapshot.key !== key);
  const next = [updated, ...rest];
  if (next.length <= MAX_RECENTS) return next;
  return rankRecents(next, input.now).slice(0, MAX_RECENTS);
}

/** Half-life of a log's contribution to the recents ranking. */
export const RECENCY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Order recents by frecency: how often, decayed by how long ago.
 *
 * Neither signal works alone. Pure recency loses the staples — the yoghurt
 * eaten every morning drops below a one-off restaurant dish logged an hour ago.
 * Pure frequency buries a food someone has just started eating daily under one
 * they ate constantly last year. The decay is exponential with a fortnight
 * half-life, which is roughly how long a diet change takes to become a habit.
 */
export function recentScore(recent: RecentFood, now: number): number {
  const ageMs = Math.max(0, now - recent.lastLoggedAt);
  const decay = Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS);
  // `log1p` so the twentieth log of a staple does not swamp the ordering.
  return (1 + Math.log1p(recent.logCount)) * decay;
}

export function rankRecents(recents: readonly RecentFood[], now: number): RecentFood[] {
  return [...recents].sort(
    (a, b) =>
      recentScore(b, now) - recentScore(a, now) ||
      b.lastLoggedAt - a.lastLoggedAt ||
      a.snapshot.key.localeCompare(b.snapshot.key),
  );
}

export function toggleFavourite(state: NutritionState, key: FoodKey): NutritionState {
  const has = state.favourites.includes(key);
  return {
    ...state,
    favourites: has ? state.favourites.filter((k) => k !== key) : [...state.favourites, key],
  };
}

/** Favourites, resolved through recents so a starred food keeps its portion. */
export function favouriteSnapshots(state: NutritionState): RecentFood[] {
  return state.favourites
    .map((key) => state.recents.find((r) => r.snapshot.key === key))
    .filter((r): r is RecentFood => r !== undefined);
}

/* ── Custom foods ────────────────────────────────────────────────────────── */

export function upsertCustomFood(state: NutritionState, food: CustomFood): NutritionState {
  const rest = state.customFoods.filter((f) => f.id !== food.id);
  return { ...state, customFoods: [food, ...rest] };
}

export function deleteCustomFood(state: NutritionState, id: string): NutritionState {
  return { ...state, customFoods: state.customFoods.filter((f) => f.id !== id) };
}
