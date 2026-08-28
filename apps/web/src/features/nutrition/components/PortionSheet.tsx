import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, NumberField, Select, Sheet } from '@freeforever/design-system';
import {
  computePortionNutrition,
  convertQuantityBetweenServings,
  defaultServing,
  formatEnergy,
  formatGrams,
  MEAL_SLOTS,
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
 * Two behaviours worth stating, both from `packages/core`:
 *
 * - **Switching unit does not change how much you ate.** Going from "2 slices"
 *   to grams shows 56 g, not 2 g. The mass is held constant and the quantity is
 *   re-expressed, which is what a person means by changing the unit.
 * - **Every quantity change re-derives from the per-100 g profile.** Tapping
 *   `+` twelve times lands exactly where typing 12 lands, with no accumulated
 *   rounding.
 */

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
    setServingIndex(index);
    setQuantity(initialQuantity ?? 1);
    setSlot(initialSlot);
    // `snapshot.key` rather than the object: a re-render with an equal snapshot
    // must not reset a portion the user is part-way through editing.
  }, [open, snapshot?.key, initialSlot, initialQuantity, initialServing?.name]);

  const serving = servings[servingIndex] ?? defaultServing(servings);

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
          />
          <Select
            label="Serving"
            value={String(servingIndex)}
            onChange={(event) => changeServing(Number(event.currentTarget.value))}
          >
            {servings.map((option, index) => (
              <option key={`${option.name}:${option.gramsPerServing}`} value={index}>
                {option.name}
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

        {portion ? (
          <p className="ffn-muted">
            {formatGrams(portion.massG, massUnit)} {massUnit}
            {portion.millilitresMl !== undefined ? ` · ${Math.round(portion.millilitresMl)} ml` : ''}
          </p>
        ) : null}

        <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
          <legend className="ffn-h2">Meal</legend>
          <div className="ffn-scope">
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
