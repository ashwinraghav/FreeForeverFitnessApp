import { useCallback, useState } from 'react';
import {
  formatEnergy,
  formatPortion,
  scaleNutrients,
  type MealSlot,
  type NutrientProfile,
  type Serving,
} from '@freeforever/core/src/nutrition/index.js';
import type { UndoableAction } from '../components/UndoToast.js';
import { newId, newIds } from './ids.js';
import {
  copyMeal,
  logFood,
  logSavedMeal,
  quickAdd,
  removeEntry,
  toggleFavourite,
} from './log.js';
import { useNutrition } from './NutritionProvider.js';
import type { FoodKey, FoodSnapshot, RecentFood } from './types.js';

/**
 * Every write the logging surfaces make, with its undo attached.
 *
 * Ids and timestamps are generated here and passed into the reducers, which
 * keeps every reducer a pure function of its arguments and keeps this the only
 * place in the feature that reads the clock.
 *
 * Each action returns an undo rather than a confirmation. That is the trade
 * that buys the tap count: writes are immediate and reversible instead of
 * confirmed and slow.
 */
export function useLogging() {
  const { state, mutate, selectedDate, tzOffsetMinutes } = useNutrition();
  const [undoAction, setUndoAction] = useState<UndoableAction | null>(null);

  const dismissUndo = useCallback(() => setUndoAction(null), []);

  const offerUndo = useCallback((message: string, undo: () => void) => {
    setUndoAction({ id: newId(), message, undo });
  }, []);

  const log = useCallback(
    (input: { snapshot: FoodSnapshot; quantity: number; serving: Serving; slot: MealSlot }) => {
      const entryId = newId();
      const now = Date.now();
      mutate((current) =>
        logFood(current, {
          date: selectedDate,
          tzOffsetMinutes,
          slot: input.slot,
          snapshot: input.snapshot,
          quantity: input.quantity,
          serving: input.serving,
          entryId,
          now,
        }),
      );

      const energy = scaleNutrients(
        input.snapshot.nutrientsPer100g,
        input.quantity * input.serving.gramsPerServing,
      ).energyKcal;

      offerUndo(
        `${input.snapshot.ref.name} · ${formatPortion(input.quantity, input.serving)} · ${formatEnergy(energy)} kcal`,
        () => mutate((current) => removeEntry(current, { date: selectedDate, entryId })),
      );
      return entryId;
    },
    [mutate, offerUndo, selectedDate, tzOffsetMinutes],
  );

  /**
   * The one-tap repeat. Uses the portion and meal remembered on the recents
   * row, so it needs nothing the device does not already hold.
   */
  const logAgainFromRecent = useCallback(
    (recent: RecentFood) =>
      log({
        snapshot: recent.snapshot,
        quantity: recent.lastQuantity,
        serving: recent.lastServing,
        slot: recent.lastSlot,
      }),
    [log],
  );

  const addQuick = useCallback(
    (input: { nutrients: NutrientProfile; name: string; slot: MealSlot }) => {
      const entryId = newId();
      const now = Date.now();
      mutate((current) =>
        quickAdd(current, {
          date: selectedDate,
          tzOffsetMinutes,
          slot: input.slot,
          nutrients: input.nutrients,
          name: input.name,
          entryId,
          now,
        }),
      );
      offerUndo(`Quick add · ${formatEnergy(input.nutrients.energyKcal)} kcal`, () =>
        mutate((current) => removeEntry(current, { date: selectedDate, entryId })),
      );
    },
    [mutate, offerUndo, selectedDate, tzOffsetMinutes],
  );

  const remove = useCallback(
    (entryId: string) => {
      const entry = state.days[selectedDate]?.meals
        .flatMap((meal) => meal.entries)
        .find((candidate) => candidate.id === entryId);
      const snapshot = state.days[selectedDate];
      mutate((current) => removeEntry(current, { date: selectedDate, entryId }));
      if (entry && snapshot) {
        // Undo by restoring the whole day: re-inserting one entry would have to
        // rebuild its sort key against neighbours that may have moved, and a
        // wrong restore is worse than none.
        offerUndo(`Removed ${entry.food.name}`, () =>
          mutate((current) => ({
            ...current,
            days: { ...current.days, [selectedDate]: snapshot },
          })),
        );
      }
    },
    [mutate, offerUndo, selectedDate, state.days],
  );

  const reuseMeal = useCallback(
    (input: { fromDate: string; fromSlot: MealSlot; toSlot: MealSlot }) => {
      const source = state.days[input.fromDate]?.meals.find((m) => m.slot === input.fromSlot);
      if (!source) return;
      const before = state.days[selectedDate];
      mutate((current) =>
        copyMeal(current, {
          fromDate: input.fromDate,
          fromSlot: input.fromSlot,
          toDate: selectedDate,
          toSlot: input.toSlot,
          tzOffsetMinutes,
          entryIds: newIds(source.entries.length),
          now: Date.now(),
        }),
      );
      offerUndo(`Copied ${source.entries.length} items`, () =>
        mutate((current) => {
          const days = { ...current.days };
          if (before) days[selectedDate] = before;
          else delete days[selectedDate];
          return { ...current, days };
        }),
      );
    },
    [mutate, offerUndo, selectedDate, state.days, tzOffsetMinutes],
  );

  const logTemplate = useCallback(
    (savedMealId: string, slot?: MealSlot) => {
      const saved = state.savedMeals.find((m) => m.id === savedMealId);
      if (!saved) return;
      const before = state.days[selectedDate];
      mutate((current) =>
        logSavedMeal(current, {
          savedMealId,
          date: selectedDate,
          tzOffsetMinutes,
          ...(slot !== undefined ? { slot } : {}),
          entryIds: newIds(saved.entries.length),
          now: Date.now(),
        }),
      );
      offerUndo(`Logged ${saved.name}`, () =>
        mutate((current) => {
          const days = { ...current.days };
          if (before) days[selectedDate] = before;
          else delete days[selectedDate];
          return { ...current, days };
        }),
      );
    },
    [mutate, offerUndo, selectedDate, state.days, state.savedMeals, tzOffsetMinutes],
  );

  const favourite = useCallback(
    (key: FoodKey) => mutate((current) => toggleFavourite(current, key)),
    [mutate],
  );

  return {
    log,
    logAgainFromRecent,
    addQuick,
    remove,
    reuseMeal,
    logTemplate,
    favourite,
    undoAction,
    dismissUndo,
  };
}
