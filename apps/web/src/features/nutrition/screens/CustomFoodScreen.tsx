import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, NumberField, Select, TextField } from '@freeforever/design-system';
import {
  atwaterDiscrepancy,
  energyFromMacros,
  formatEnergy,
  servingsForFood,
  type NutrientProfile,
} from '@freeforever/core/src/nutrition/index.js';
import { newId } from '../data/ids.js';
import { upsertCustomFood } from '../data/log.js';
import { useNutrition } from '../data/NutritionProvider.js';
import type { CustomFood } from '../data/types.js';
import { normaliseBarcode } from '../scan/barcode.js';

/**
 * Create a food from what is on the packet.
 *
 * Reached from two places, and the second one is the important one: an unknown
 * barcode routes here with the number already filled in. Someone standing in
 * their kitchen holding the packet is the best source of that record there will
 * ever be, and every dead end at that moment is a food lost permanently.
 *
 * The form asks for per-100 g figures because that is what is on a European
 * label and what every dataset stores. A US label states per-serving; the
 * serving field converts, so the user never does arithmetic the app could do.
 */
export function CustomFoodScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { state, mutate } = useNutrition();

  const [name, setName] = useState(params.get('name') ?? '');
  const [brand, setBrand] = useState('');
  const [barcode] = useState(params.get('barcode') ?? '');
  const [basis, setBasis] = useState<'per100' | 'perServing'>('per100');

  const [energy, setEnergy] = useState<number | null>(null);
  const [protein, setProtein] = useState<number | null>(null);
  const [carbs, setCarbs] = useState<number | null>(null);
  const [fat, setFat] = useState<number | null>(null);
  const [fibre, setFibre] = useState<number | null>(null);
  const [sugar, setSugar] = useState<number | null>(null);
  const [sodium, setSodium] = useState<number | null>(null);
  const [satFat, setSatFat] = useState<number | null>(null);
  const [servingGrams, setServingGrams] = useState<number | null>(null);
  const [servingLabel, setServingLabel] = useState('');

  /**
   * The entered figures, normalised to per 100 g.
   *
   * A field left blank stays absent rather than becoming zero: "no fibre
   * figure" and "no fibre" are different claims, and the day totals preserve
   * the difference all the way to the micronutrient panel.
   */
  const per100g = useMemo<NutrientProfile>(() => {
    const factor =
      basis === 'per100' || servingGrams === null || servingGrams <= 0
        ? 1
        : 100 / servingGrams;
    const scale = (value: number | null): number | undefined =>
      value === null ? undefined : value * factor;

    const profile: NutrientProfile = {
      energyKcal: scale(energy) ?? 0,
      proteinG: scale(protein) ?? 0,
      carbsG: scale(carbs) ?? 0,
      fatG: scale(fat) ?? 0,
    };
    const fibreValue = scale(fibre);
    const sugarValue = scale(sugar);
    const sodiumValue = scale(sodium);
    const satFatValue = scale(satFat);
    if (fibreValue !== undefined) profile.fiberG = fibreValue;
    if (sugarValue !== undefined) profile.sugarG = sugarValue;
    if (sodiumValue !== undefined) profile.sodiumMg = sodiumValue;
    if (satFatValue !== undefined) profile.saturatedFatG = satFatValue;
    return profile;
  }, [basis, servingGrams, energy, protein, carbs, fat, fibre, sugar, sodium, satFat]);

  const impliedKcal = energyFromMacros(per100g);
  const discrepancy = atwaterDiscrepancy(per100g);
  const nameOk = name.trim() !== '';
  const hasSomething = per100g.energyKcal > 0 || impliedKcal > 0;
  const needsServingMass = basis === 'perServing' && (servingGrams === null || servingGrams <= 0);

  const save = () => {
    const id = newId();
    const cleanBarcode = normaliseBarcode(barcode);
    const food: CustomFood = {
      id,
      name: name.trim(),
      source: cleanBarcode !== null ? 'barcode' : 'custom',
      nutrientsPer100g: { ...per100g, energyKcal: per100g.energyKcal > 0 ? per100g.energyKcal : impliedKcal },
      servings: servingsForFood({
        statedServingGrams: servingGrams,
        statedServingLabel: servingLabel.trim() === '' ? null : servingLabel.trim(),
        basis: 'g',
        imperial: state.preferences.massUnit === 'oz',
      }),
      createdAt: Date.now(),
      ...(brand.trim() !== '' ? { brand: brand.trim() } : {}),
      ...(cleanBarcode !== null ? { barcode: cleanBarcode } : {}),
    };
    mutate((current) => upsertCustomFood(current, food));
    navigate('..');
  };

  return (
    <div className="ffn ffn-pad">
      <h1 className="ffn-h1" style={{ marginBlock: 'var(--ff-space-16)' }}>
        Add a food
      </h1>

      {barcode !== '' ? (
        <p className="ffn-notice">
          Barcode {barcode} will be saved with this food, so the next scan finds it instantly.
        </p>
      ) : null}

      <div className="ffn-fields">
        <TextField
          label="Name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          required
        />
        <TextField
          label="Brand"
          value={brand}
          onChange={(event) => setBrand(event.currentTarget.value)}
          hint="Optional."
        />

        <Select
          label="The numbers on the label are"
          value={basis}
          onChange={(event) => setBasis(event.currentTarget.value as 'per100' | 'perServing')}
          hint="European labels state per 100 g. US labels state per serving."
        >
          <option value="per100">Per 100 g</option>
          <option value="perServing">Per serving</option>
        </Select>

        <div className="ffn-fields-2">
          <NumberField
            label="Serving size"
            unit="g"
            value={servingGrams}
            onValueChange={setServingGrams}
            step={5}
            min={0}
            {...(needsServingMass ? { error: 'Needed to convert per-serving figures.' } : {})}
          />
          <TextField
            label="Serving name"
            value={servingLabel}
            onChange={(event) => setServingLabel(event.currentTarget.value)}
            hint="“1 slice”, “1 bar”."
          />
        </div>

        <h2 className="ffn-h2">Nutrition {basis === 'per100' ? 'per 100 g' : 'per serving'}</h2>
        <div className="ffn-fields-2">
          <NumberField label="Energy" unit="kcal" value={energy} onValueChange={setEnergy} step={10} min={0} ghostValue={impliedKcal > 0 ? Math.round(impliedKcal) : null} />
          <NumberField label="Protein" unit="g" value={protein} onValueChange={setProtein} step={0.5} min={0} />
          <NumberField label="Carbs" unit="g" value={carbs} onValueChange={setCarbs} step={0.5} min={0} />
          <NumberField label="Fat" unit="g" value={fat} onValueChange={setFat} step={0.5} min={0} />
        </div>

        <h2 className="ffn-h2">Optional — leave blank if the label does not say</h2>
        <div className="ffn-fields-2">
          <NumberField label="Fibre" unit="g" value={fibre} onValueChange={setFibre} step={0.5} min={0} />
          <NumberField label="Sugars" unit="g" value={sugar} onValueChange={setSugar} step={0.5} min={0} />
          <NumberField label="Saturated fat" unit="g" value={satFat} onValueChange={setSatFat} step={0.5} min={0} />
          <NumberField label="Sodium" unit="mg" value={sodium} onValueChange={setSodium} step={10} min={0} />
        </div>

        {hasSomething && discrepancy > 0.25 && per100g.energyKcal > 0 ? (
          <p className="ffn-notice">
            The energy on the label ({formatEnergy(per100g.energyKcal)} kcal) disagrees with its
            own macros ({formatEnergy(impliedKcal)} kcal) by more than a quarter. That happens
            legitimately with sugar alcohols, alcohol and unusual fibre — but it is worth a second
            look at the numbers. Saved either way.
          </p>
        ) : null}

        <Button
          variant="primary"
          size="xl"
          block
          disabled={!nameOk || !hasSomething || needsServingMass}
          onClick={save}
        >
          Save food
        </Button>
      </div>
    </div>
  );
}
