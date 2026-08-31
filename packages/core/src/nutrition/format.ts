import { roundTo } from './nutrients.js';
import {
  GENERIC_SERVING_NAME,
  GRAMS_PER_OUNCE,
  hasStatedServing,
  servingNameCarriesCount,
} from './portions.js';
import type { NutrientProfile, Serving } from './types.js';

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

/* ── The serving picker, and the line under the amount ───────────────────── */

/** One row of the serving picker: the serving, how to name it, where it came from. */
export interface ServingChoice {
  serving: Serving;
  /** Picker text. Never `Serving.name` alone — "g" is not a choice, "Grams" is. */
  label: string;
  /** True for the food's own serving, from the packet. */
  stated: boolean;
}

/**
 * Names for the units offered on every food. A `<select>` on a phone shows the
 * chosen option and nothing else, so "g" and "100 g" sitting next to each other
 * is a puzzle; "Grams" and "100 g" is a choice.
 */
const GENERIC_SERVING_LABELS: Record<string, string> = {
  g: 'Grams',
  ml: 'Millilitres',
  oz: 'Ounces',
  'fl oz': 'Fluid ounces',
  cup: 'Cups',
  '100 g': '100 g',
  '100 ml': '100 ml',
};

/**
 * The size of one serving, in the unit the food is measured in.
 *
 * Volume wins for a liquid: a carton says 250 ml, and converting that to 258 g
 * of milk to show it back is arithmetic nobody asked for.
 */
export function formatServingSize(serving: Serving, massUnit: MassDisplayUnit = 'g'): string {
  if (serving.millilitresPerServing !== undefined) {
    return formatMillilitres(serving.millilitresPerServing);
  }
  return `${formatGrams(serving.gramsPerServing, massUnit)} ${massUnit}`;
}

/**
 * How the packet's own wording reads back: `1 scoop`, `2 tbsp`, `1 serving`.
 */
export function statedServingLabel(serving: Serving): string {
  if (serving.name === GENERIC_SERVING_NAME) return '1 serving';
  if (servingNameCarriesCount(serving.name)) return serving.name;
  return `1 ${serving.name}`;
}

/**
 * The serving picker's rows, in order, ready to render.
 *
 * The stated serving is spelled out twice on purpose — `1 serving — 1 scoop
 * (31 g)`. The left half says what tapping it logs; the right half says what
 * the packet calls it and what it weighs, which is the fact a user checks
 * before trusting the number.
 *
 * A food with no stated serving gets no "1 serving" row at all. Inventing one
 * that means 100 g is a threefold error on anything dense — oil, whey, peanut
 * butter — and it is the kind of error a user never catches, because the
 * number looks like it came from the packet.
 */
export function servingChoices(
  servings: readonly Serving[],
  opts: { massUnit?: MassDisplayUnit } = {},
): ServingChoice[] {
  const stated = hasStatedServing(servings);
  return servings.map((serving, index) => {
    if (stated && index === 0) {
      const size = formatServingSize(serving, opts.massUnit ?? 'g');
      return {
        serving,
        stated: true,
        label:
          serving.name === GENERIC_SERVING_NAME
            ? `1 serving (${size})`
            : `1 serving — ${statedServingLabel(serving)} (${size})`,
      };
    }
    return {
      serving,
      stated: false,
      label: GENERIC_SERVING_LABELS[serving.name] ?? serving.name,
    };
  });
}

/**
 * The chosen amount, written the way a person would say it.
 *
 * `formatPortion` above is the log list's version and always spells out the
 * multiplication, because a row in a day's history has to be unambiguous out of
 * context. This one sits directly under the field the number came from, so
 * `1 × 100 g (100 g)` would be three ways of saying the same thing; it collapses
 * a generic unit to the amount itself and only spells out a stated serving.
 */
export function formatPortionAmount(
  quantity: number,
  serving: Serving,
  massUnit: MassDisplayUnit = 'g',
): string {
  const grams = quantity * serving.gramsPerServing;
  const millilitres =
    serving.millilitresPerServing !== undefined
      ? quantity * serving.millilitresPerServing
      : undefined;

  switch (serving.name) {
    case 'g':
    case '100 g':
      return `${formatGrams(grams, massUnit)} ${massUnit}`;
    case 'ml':
    case '100 ml':
      return formatMillilitres(millilitres ?? grams);
    case 'oz':
      return `${formatQuantity(quantity)} oz (${formatGrams(grams)} g)`;
    case 'fl oz':
    case 'cup':
      return `${formatQuantity(quantity)} ${serving.name} (${formatMillilitres(millilitres ?? grams)})`;
    default:
      break;
  }

  const size =
    millilitres !== undefined
      ? formatMillilitres(millilitres)
      : `${formatGrams(grams, massUnit)} ${massUnit}`;
  return quantity === 1
    ? `${statedServingLabel(serving)} (${size})`
    : `${formatQuantity(quantity)} × ${serving.name} (${size})`;
}

/**
 * The read-only line under the amount: what one tap of "Log it" will record.
 *
 * The user asked for this by name, and asked for it to be text rather than
 * another input — "just a subtitle or subtext". So it is a description of a
 * decision already made, not a control, and nothing in it is tappable.
 *
 * **Rounding.** `~120 kcal`, never `119.97 kcal`. Energy is whole units, the
 * same rule the ring and every macro row already use, and it carries a `~`
 * because it is the figure most likely to have been derived rather than
 * measured (`energyDerived` fires on about a quarter of USDA records). Mass
 * follows the app's macro rule — one decimal below 10, none above — so the
 * subtitle and the figures beside it can never disagree by a digit.
 */
export function formatPortionSubtitle(input: {
  quantity: number;
  serving: Serving;
  /** Absolute nutrients for this portion, already multiplied out. */
  nutrients: NutrientProfile;
  energyUnit?: EnergyDisplayUnit;
  massUnit?: MassDisplayUnit;
}): string {
  const energyUnit = input.energyUnit ?? 'kcal';
  const massUnit = input.massUnit ?? 'g';
  return [
    formatPortionAmount(input.quantity, input.serving, massUnit),
    `~${formatEnergy(input.nutrients.energyKcal, energyUnit)} ${energyUnit}`,
    `${formatGrams(input.nutrients.proteinG, massUnit)} ${massUnit} protein`,
  ].join(' · ');
}
