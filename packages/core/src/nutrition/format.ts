import { roundTo } from './nutrients.js';
import { GRAMS_PER_OUNCE } from './portions.js';
import type { Serving } from './types.js';

/**
 * Display formatting.
 *
 * The one-way door. Everything above this line is canonical numbers; everything
 * returned from here is a string on its way to a DOM node and must never travel
 * back into a document (`packages/data/src/common/units.ts`). Keeping the
 * conversion in one module is what makes that rule checkable rather than
 * aspirational — nothing else in the feature is allowed to build a unit string.
 */

/** Thermochemical kilocalorie, exact by definition. Mirrors `@freeforever/data`. */
export const KILOJOULES_PER_KILOCALORIE = 4.184;

export type EnergyDisplayUnit = 'kcal' | 'kJ';
export type MassDisplayUnit = 'g' | 'oz';

/**
 * Energy, in the user's preferred unit.
 *
 * Whole numbers only. A calorie figure with a decimal place claims a precision
 * the underlying dataset does not have, and the extra glyph costs legibility at
 * arm's length in a kitchen.
 */
export function formatEnergy(kcal: number, unit: EnergyDisplayUnit = 'kcal'): string {
  const value = unit === 'kJ' ? kcal * KILOJOULES_PER_KILOCALORIE : kcal;
  return `${Math.round(value)}`;
}

export function energyUnitLabel(unit: EnergyDisplayUnit = 'kcal'): string {
  return unit;
}

/**
 * A macro figure in grams.
 *
 * One decimal below 10 g, none above. A 4.5 g difference in fat matters; a 0.4 g
 * difference in a 180 g carbohydrate target does not, and the digit only makes
 * the column harder to scan.
 */
export function formatGrams(grams: number, unit: MassDisplayUnit = 'g'): string {
  const value = unit === 'oz' ? grams / GRAMS_PER_OUNCE : grams;
  const decimals = Math.abs(value) < 10 ? 1 : 0;
  // Through `roundTo`, not `toFixed` alone: `toFixed` rounds the binary value,
  // so 9.95 renders as "9.9". Display rounding and storage rounding disagreeing
  // is how a total appears not to equal the rows above it.
  return roundTo(value, decimals).toFixed(decimals);
}

/** Milligrams, for micronutrients. Switches to grams past 1000 to keep it short. */
export function formatMilligrams(mg: number): string {
  if (Math.abs(mg) >= 1000) return `${(mg / 1000).toFixed(1)} g`;
  return `${Math.round(mg)} mg`;
}

export function formatMillilitres(ml: number): string {
  if (Math.abs(ml) >= 1000) return `${(ml / 1000).toFixed(1)} L`;
  return `${Math.round(ml)} ml`;
}

/**
 * A quantity of servings. Trims a trailing `.0` so the common case reads "1
 * slice" rather than "1.0 slice".
 */
export function formatQuantity(quantity: number): string {
  const rounded = Math.round(quantity * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}` : `${rounded}`.replace(/0+$/, '');
}

/**
 * The portion line under a food's name: what the user chose, plus the mass it
 * resolves to, because the mass is the number the maths actually used.
 *
 * The mass is shown even for a gram serving — "100 × g" would be absurd, so
 * that case collapses to "100 g".
 */
export function formatPortion(quantity: number, serving: Serving): string {
  const grams = quantity * serving.gramsPerServing;
  if (serving.name === 'g') return `${Math.round(grams)} g`;
  if (serving.name === 'ml' && serving.millilitresPerServing !== undefined) {
    return `${Math.round(quantity * serving.millilitresPerServing)} ml`;
  }
  return `${formatQuantity(quantity)} × ${serving.name} (${Math.round(grams)} g)`;
}

/**
 * A signed remaining figure. The sign is spelled out rather than left to a
 * minus glyph and a colour: "120 over" survives greyscale and a sun-washed
 * screen, "−120" in red does not (ADR-0013).
 */
export function formatRemaining(
  remaining: number,
  unit: 'kcal' | 'g',
  energyUnit: EnergyDisplayUnit = 'kcal',
): { value: string; suffix: 'left' | 'over' } {
  const over = remaining < 0;
  const magnitude = Math.abs(remaining);
  return {
    value: unit === 'kcal' ? formatEnergy(magnitude, energyUnit) : formatGrams(magnitude),
    suffix: over ? 'over' : 'left',
  };
}

/** A 0..1 fraction as a whole percentage. Clamped, so a ring label never reads 143%. */
export function formatPercent(fraction: number): string {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}
