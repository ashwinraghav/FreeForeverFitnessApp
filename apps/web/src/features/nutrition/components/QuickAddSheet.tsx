import { useEffect, useState } from 'react';
import { Button, Chip, NumberField, Sheet, TextField } from '@freeforever/design-system';
import {
  energyFromMacros,
  formatEnergy,
  MEAL_SLOTS,
  type MealSlot,
  type NutrientProfile,
} from '@freeforever/core/src/nutrition/index.js';

/**
 * Log macros with no food behind them.
 *
 * The escape hatch that keeps the rest of the log honest. Somebody eats a meal
 * in a restaurant that no database contains; the choice is between recording
 * what they actually know and abandoning the day. An app without this gets
 * abandoned days, and an abandoned day is worse than an approximate one.
 *
 * The energy field defaults to the Atwater sum of whatever macros are entered,
 * because that is almost always the right answer and typing it again is a tax.
 */
export function QuickAddSheet({
  open,
  onClose,
  initialSlot,
  energyUnit,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  initialSlot: MealSlot;
  energyUnit: 'kcal' | 'kJ';
  onAdd: (input: { nutrients: NutrientProfile; name: string; slot: MealSlot }) => void;
}) {
  const [name, setName] = useState('');
  const [protein, setProtein] = useState<number | null>(null);
  const [carbs, setCarbs] = useState<number | null>(null);
  const [fat, setFat] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [slot, setSlot] = useState<MealSlot>(initialSlot);

  useEffect(() => {
    if (!open) return;
    setName('');
    setProtein(null);
    setCarbs(null);
    setFat(null);
    setEnergy(null);
    setSlot(initialSlot);
  }, [open, initialSlot]);

  const macros: NutrientProfile = {
    energyKcal: 0,
    proteinG: protein ?? 0,
    carbsG: carbs ?? 0,
    fatG: fat ?? 0,
  };
  const impliedKcal = energyFromMacros(macros);
  const effectiveKcal = energy ?? impliedKcal;
  const canAdd = effectiveKcal > 0 || impliedKcal > 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Quick add"
      actions={
        <div className="ffn-sheet-actions">
          <Button
            variant="primary"
            size="xl"
            disabled={!canAdd}
            onClick={() =>
              onAdd({
                nutrients: { ...macros, energyKcal: effectiveKcal },
                name: name.trim(),
                slot,
              })
            }
          >
            Add
          </Button>
        </div>
      }
    >
      <div className="ffn-fields">
        <TextField
          label="What was it?"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="Lunch out"
          hint="Optional. Helps you recognise it in the log later."
        />

        <div className="ffn-fields-2">
          <NumberField label="Protein" unit="g" value={protein} onValueChange={setProtein} step={1} min={0} placeholder="0" />
          <NumberField label="Carbs" unit="g" value={carbs} onValueChange={setCarbs} step={1} min={0} placeholder="0" />
          <NumberField label="Fat" unit="g" value={fat} onValueChange={setFat} step={1} min={0} placeholder="0" />
          <NumberField
            label="Energy"
            unit={energyUnit}
            value={energy}
            onValueChange={setEnergy}
            placeholder="0"
            /* The ghost is the Atwater sum: visibly not entered, and the value
               used if the user leaves the field alone. */
            ghostValue={impliedKcal > 0 ? Math.round(impliedKcal) : null}
            step={10}
            min={0}
            hint="Leave blank to use the total from the macros."
          />
        </div>

        <p className="ffn-muted">
          Will log {formatEnergy(effectiveKcal, energyUnit)} {energyUnit}.
        </p>

        <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
          <legend className="ffn-h2">Meal</legend>
          <div className="ffn-scope">
            {MEAL_SLOTS.map((option) => (
              <Chip key={option} selected={slot === option} onClick={() => setSlot(option)}>
                {option.replace('_', ' ')}
              </Chip>
            ))}
          </div>
        </fieldset>
      </div>
    </Sheet>
  );
}
