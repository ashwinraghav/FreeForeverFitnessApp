import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, NumberField, Select, Sheet } from '@freeforever/design-system';
import {
  computePortionNutrition,
  convertQuantityBetweenServings,
  defaultPortion,
  defaultServing,
  formatEnergy,
  formatGrams,
  formatPortionSubtitle,
  hasStatedServing,
  MEAL_SLOTS,
  servingChoices,
  type MealSlot,
  type Serving,
} from '@freeforever/core/src/nutrition/index.js';
import { FoodFlags } from './FoodFlags.js';
import type { FoodSnapshot } from '../data/types.js';

/**
 * Choose a portion and log it.
 *
 * `Sheet`, not `Dialog`: non-blocking, so nothing here can swallow what the
 * user already entered. A modal in a logging flow is the failure mode
 * CLAUDE.md names outright.
 *
 * Three behaviours worth stating, all from `packages/core`:
 *
 * - **Switching unit does not change how much you ate.** Going from "2 slices"
 *   to grams shows 56 g, not 2 g. The mass is held constant and the quantity is
 *   re-expressed, which is what a person means by changing the unit.
 * - **Every quantity change re-derives from the per-100 g profile.** Tapping
 *   `+` twelve times lands exactly where typing 12 lands, with no accumulated
 *   rounding.
 * - **The food opens on its own serving.** One scoop of whey, not 100 g of
 *   powder. A food that states no serving opens on 100 g and says so, rather
 *   than dressing 100 g up as "one serving" — for anything dense that is a
 *   threefold logging error the user has no way to spot.
 *
 * The line under the amount is text, never a control. The user asked for that
 * in those words: "not an editable thing, just a subtitle or subtext". It is
 * the `hint` of the amount field, so it is also what a screen reader reads out
 * as the field's description.
 */

/**
 * Said out loud, rather than left to the absence of an option.
 *
 * A caveat, not a warning: roughly six foods in ten in today's index state no
 * serving, and a solid badge on every one of them would shout past the button
 * that logs the food. It sits under the picker it explains, as that field's
 * description, so a screen reader reaches it by moving to the control rather
 * than by hunting for a paragraph.
 *
 * What it must never become is silence. Treating 100 g as one serving is how
 * someone logs a third of the whey they actually drank.
 */
const MISSING_SERVING_HINT = 'No serving size on this food, so amounts are by weight.';

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
  pre_workout: 'Pre-workout',
  post_workout: 'Post-workout',
  other: 'Other',
};

export interface PortionSheetProps {
  open: boolean;
  onClose: () => void;
  snapshot: FoodSnapshot | null;
  /** Pre-selected meal, from where the sheet was opened. */
  initialSlot: MealSlot;
  initialQuantity?: number;
  initialServing?: Serving;
  massUnit: 'g' | 'oz';
  energyUnit: 'kcal' | 'kJ';
  onLog: (input: { quantity: number; serving: Serving; slot: MealSlot }) => void;
  /** Star state. Favourites are free and cost one tap here. */
  isFavourite?: boolean;
  onToggleFavourite?: () => void;
  submitLabel?: string;
}

export function PortionSheet({
  open,
  onClose,
  snapshot,
  initialSlot,
  initialQuantity,
  initialServing,
  massUnit,
  energyUnit,
  onLog,
  isFavourite = false,
  onToggleFavourite,
  submitLabel = 'Log it',
}: PortionSheetProps) {
  const servings = snapshot?.servings ?? [];
  const [servingIndex, setServingIndex] = useState(0);
  const [quantity, setQuantity] = useState<number | null>(1);
  const [slot, setSlot] = useState<MealSlot>(initialSlot);

  // Reset when a different food is opened; keeping the previous food's portion
  // would silently log the wrong amount.
  useEffect(() => {
    if (!open || !snapshot) return;
    const index = initialServing
      ? Math.max(0, servings.findIndex((s) => s.name === initialServing.name))
      : 0;
    const opening = defaultPortion(servings);
    setServingIndex(index);
    // `defaultPortion`, not a hard-coded 1: a food with no stated serving opens
    // on 100 g, and a food with one opens on exactly one of them.
    setQuantity(initialQuantity ?? (initialServing ? 1 : opening.quantity));
    setSlot(initialSlot);
    // `snapshot.key` rather than the object: a re-render with an equal snapshot
    // must not reset a portion the user is part-way through editing.
  }, [open, snapshot?.key, initialSlot, initialQuantity, initialServing?.name]);

  const serving = servings[servingIndex] ?? defaultServing(servings);
  const choices = servingChoices(servings, { massUnit });
  const stated = hasStatedServing(servings);

  const portion = useMemo(() => {
    if (!snapshot || !serving) return null;
    const q = quantity ?? 0;
    if (q < 0) return null;
    return computePortionNutrition({
      nutrientsPer100g: snapshot.nutrientsPer100g,
      quantity: q,
      serving,
    });
  }, [snapshot, serving, quantity]);

  if (!snapshot || !serving) return null;

  const changeServing = (index: number) => {
    const next = servings[index];
    if (!next) return;
    // Hold the mass constant across the switch.
    setQuantity(convertQuantityBetweenServings(quantity ?? 0, serving, next));
    setServingIndex(index);
  };

  // A gram-denominated serving steps by 5 g; a "slice" steps by half of one.
  const step = serving.gramsPerServing <= 1 ? 5 : 0.5;

  /**
   * The read-only line under the amount.
   *
   * Rounding is stated once, here and in `formatPortionSubtitle`: whole
   * kilocalories with a `~`, and the app's standard macro rule for grams. This
   * is supporting text, not an audit trail — the exact figures logged are the
   * ones in the summary below it.
   */
  const subtitle =
    portion !== null
      ? formatPortionSubtitle({
          quantity: quantity ?? 0,
          serving,
          nutrients: portion.nutrients,
          energyUnit,
          massUnit,
        })
      : undefined;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={snapshot.ref.name}
      actions={
        <div className="ffn-sheet-actions">
          {onToggleFavourite ? (
            <Button variant="ghost" size="lg" onClick={onToggleFavourite} aria-pressed={isFavourite}>
              {isFavourite ? '★ Favourite' : '☆ Favourite'}
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="xl"
            onClick={() => {
              if (quantity === null || quantity <= 0) return;
              onLog({ quantity, serving, slot });
            }}
            disabled={quantity === null || quantity <= 0}
          >
            {submitLabel}
          </Button>
        </div>
      }
    >
      <div className="ffn-fields">
        {snapshot.ref.brand !== undefined ? (
          <p className="ffn-muted">{snapshot.ref.brand}</p>
        ) : null}

        <div className="ffn-fields-2">
          <NumberField
            label="Amount"
            value={quantity}
            onValueChange={setQuantity}
            step={step}
            min={0}
            unit={serving.name}
            {...(subtitle !== undefined ? { hint: subtitle } : {})}
          />
          <Select
            label="Serving"
            value={String(servingIndex)}
            onChange={(event) => changeServing(Number(event.currentTarget.value))}
            {...(stated ? {} : { hint: MISSING_SERVING_HINT })}
          >
            {choices.map((choice, index) => (
              <option
                key={`${choice.serving.name}:${choice.serving.gramsPerServing}`}
                value={index}
              >
                {choice.label}
              </option>
            ))}
          </Select>
        </div>

        {portion ? (
          <div className="ffn-portion-summary">
            <div className="ffn-portion-figure">
              <b>{formatEnergy(portion.nutrients.energyKcal, energyUnit)}</b>
              <span>{energyUnit}</span>
            </div>
            <div className="ffn-portion-figure">
              <b>{formatGrams(portion.nutrients.proteinG, massUnit)}</b>
              <span>protein</span>
            </div>
            <div className="ffn-portion-figure">
              <b>{formatGrams(portion.nutrients.carbsG, massUnit)}</b>
              <span>carbs</span>
            </div>
            <div className="ffn-portion-figure">
              <b>{formatGrams(portion.nutrients.fatG, massUnit)}</b>
              <span>fat</span>
            </div>
          </div>
        ) : null}

        <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
          <legend className="ffn-h2">Meal</legend>
          <div className="ffn-chips">
            {MEAL_SLOTS.map((option) => (
              <Chip key={option} selected={slot === option} onClick={() => setSlot(option)}>
                {SLOT_LABELS[option]}
              </Chip>
            ))}
          </div>
        </fieldset>

        <FoodFlags snapshot={snapshot} />
      </div>
    </Sheet>
  );
}
