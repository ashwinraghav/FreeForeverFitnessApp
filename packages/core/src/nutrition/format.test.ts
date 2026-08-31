import { describe, expect, it } from 'vitest';
import {
  formatEnergy,
  formatGrams,
  formatMillilitres,
  formatMilligrams,
  formatPercent,
  formatPortion,
  formatPortionAmount,
  formatPortionSubtitle,
  formatQuantity,
  servingChoices,
  formatRemaining,
  KILOJOULES_PER_KILOCALORIE,
} from './format.js';
import { GRAM_SERVING, GRAMS_PER_OUNCE, servingsForFood } from './portions.js';
import { scaleNutrients } from './nutrients.js';
import type { NutrientProfile } from './types.js';

/** Optimum Nutrition Gold Standard 100% Whey, vanilla. One scoop is 31 g. */
const WHEY_PER_100G: NutrientProfile = {
  energyKcal: 387,
  proteinG: 77.4,
  carbsG: 9.7,
  fatG: 3.2,
};
const WHEY_SERVINGS = servingsForFood({
  statedServingGrams: 31,
  statedServingLabel: '1 scoop (31 g)',
  basis: 'g',
});

describe('formatEnergy', () => {
  it('shows whole kilocalories', () => {
    expect(formatEnergy(2210.4)).toBe('2210');
    expect(formatEnergy(0)).toBe('0');
  });

  it('converts to kilojoules on request', () => {
    expect(formatEnergy(100, 'kJ')).toBe(String(Math.round(100 * KILOJOULES_PER_KILOCALORIE)));
    expect(formatEnergy(100, 'kJ')).toBe('418');
  });
});

describe('formatGrams', () => {
  it('shows one decimal below 10 g and none above', () => {
    expect(formatGrams(3.64)).toBe('3.6');
    expect(formatGrams(31.2)).toBe('31');
    // Rounds the decimal value, not the binary one: plain `toFixed` gives "9.9".
    expect(formatGrams(9.95)).toBe('10.0');
  });

  it('converts to ounces on request', () => {
    expect(formatGrams(GRAMS_PER_OUNCE * 6, 'oz')).toBe('6.0');
    expect(formatGrams(GRAMS_PER_OUNCE * 16, 'oz')).toBe('16');
  });
});

describe('formatMilligrams', () => {
  it('shows milligrams for a small figure', () => {
    expect(formatMilligrams(74)).toBe('74 mg');
  });

  it('switches to grams past 1000 mg so the column stays short', () => {
    expect(formatMilligrams(2400)).toBe('2.4 g');
  });
});

describe('formatMillilitres', () => {
  it('switches to litres past 1000 ml', () => {
    expect(formatMillilitres(750)).toBe('750 ml');
    expect(formatMillilitres(2800)).toBe('2.8 L');
  });
});

describe('formatQuantity', () => {
  it('does not print a trailing .0 on a whole number of servings', () => {
    expect(formatQuantity(1)).toBe('1');
    expect(formatQuantity(1.0)).toBe('1');
  });

  it('keeps a real fraction', () => {
    expect(formatQuantity(1.5)).toBe('1.5');
    expect(formatQuantity(0.25)).toBe('0.25');
  });
});

describe('formatPortion', () => {
  it('collapses a gram serving to a plain mass', () => {
    expect(formatPortion(150, { name: 'g', gramsPerServing: 1 })).toBe('150 g');
  });

  it('collapses a millilitre serving to a plain volume', () => {
    expect(formatPortion(250, { name: 'ml', gramsPerServing: 1.03, millilitresPerServing: 1 })).toBe(
      '250 ml',
    );
  });

  it('shows a named serving with the mass it resolves to', () => {
    expect(formatPortion(2, { name: 'slice', gramsPerServing: 28 })).toBe('2 × slice (56 g)');
    expect(formatPortion(1.5, { name: 'cup', gramsPerServing: 240 })).toBe('1.5 × cup (360 g)');
  });
});

describe('formatRemaining', () => {
  it('spells out "left" rather than relying on a colour', () => {
    expect(formatRemaining(340, 'kcal')).toEqual({ value: '340', suffix: 'left' });
  });

  it('spells out "over" rather than relying on a minus glyph', () => {
    // A red "−120" is invisible in greyscale and on a sun-washed screen (ADR-0013).
    expect(formatRemaining(-120, 'kcal')).toEqual({ value: '120', suffix: 'over' });
  });

  it('formats a macro remainder in grams', () => {
    expect(formatRemaining(-4.5, 'g')).toEqual({ value: '4.5', suffix: 'over' });
  });
});

describe('formatPercent', () => {
  it('clamps so a ring label never reads over 100%', () => {
    expect(formatPercent(1.43)).toBe('100%');
    expect(formatPercent(-0.2)).toBe('0%');
    expect(formatPercent(0.755)).toBe('76%');
  });
});

describe('the serving picker offers real choices', () => {
  it('names the food’s own serving, what the packet calls it, and what it weighs', () => {
    expect(servingChoices(WHEY_SERVINGS).map((c) => c.label)).toEqual([
      '1 serving — 1 scoop (31 g)',
      'Grams',
    ]);
    expect(servingChoices(WHEY_SERVINGS)[0]?.stated).toBe(true);
  });

  it('offers no "1 serving" row at all for a food that states none', () => {
    // The degraded case, and the one that must not lie. 100 g of whey is three
    // scoops; a "1 serving" row meaning 100 g would treble a logged shake.
    const choices = servingChoices(servingsForFood({ basis: 'g' }));
    expect(choices.map((c) => c.label)).toEqual(['Grams']);
    expect(choices.some((c) => c.stated)).toBe(false);
    expect(choices.some((c) => c.label.includes('serving'))).toBe(false);
  });

  it('measures a drink in millilitres', () => {
    const choices = servingChoices(
      servingsForFood({ statedServingGrams: 250, statedServingLabel: '1 bottle', basis: 'ml' }),
    );
    expect(choices.map((c) => c.label)).toEqual([
      '1 serving — 1 bottle (250 ml)',
      'Millilitres',
      'Grams',
    ]);
  });

  it('reads a serving that is two of something back as two of something', () => {
    const choices = servingChoices(
      servingsForFood({ statedServingGrams: 32, statedServingLabel: '2 tbsp', basis: 'g' }),
    );
    expect(choices[0]?.label).toBe('1 serving — 2 tbsp (32 g)');
  });
});

describe('the read-only line under the amount', () => {
  const subtitleFor = (quantity: number, index: number) => {
    const serving = WHEY_SERVINGS[index] ?? GRAM_SERVING;
    return formatPortionSubtitle({
      quantity,
      serving,
      nutrients: scaleNutrients(WHEY_PER_100G, quantity * serving.gramsPerServing),
    });
  };

  it('says what one scoop is, rounded to something a person would say', () => {
    // The user's test: select the food, select one serving, and read off what
    // it is. 119.97 kcal is not what anyone means.
    expect(subtitleFor(1, 0)).toBe('1 scoop (31 g) · ~120 kcal · 24 g protein');
  });

  it('spells out the multiplication past one serving', () => {
    expect(subtitleFor(2, 0)).toBe('2 × scoop (62 g) · ~240 kcal · 48 g protein');
  });

  it('claims no serving when the amount is a plain weight', () => {
    expect(subtitleFor(100, 1)).toBe('100 g · ~387 kcal · 77 g protein');
    expect(subtitleFor(30, 1)).toBe('30 g · ~116 kcal · 23 g protein');
  });

  it('follows the user’s units', () => {
    expect(
      formatPortionSubtitle({
        quantity: 100,
        serving: GRAM_SERVING,
        nutrients: scaleNutrients(WHEY_PER_100G, 100),
        energyUnit: 'kJ',
        massUnit: 'oz',
      }),
    ).toBe('3.5 oz · ~1619 kJ · 2.7 oz protein');
  });
});

describe('formatPortionAmount', () => {
  it('does not say the same thing three ways', () => {
    // `formatPortion` renders "1 × 100 g (100 g)" for a log row, where the
    // multiplication has to be unambiguous out of context. Under the field the
    // number was typed into, it is noise.
    expect(formatPortionAmount(1, { name: '100 g', gramsPerServing: 100 })).toBe('100 g');
    expect(formatPortionAmount(2.5, { name: '100 g', gramsPerServing: 100 })).toBe('250 g');
    expect(formatPortionAmount(80, { name: 'g', gramsPerServing: 1 })).toBe('80 g');
  });

  it('keeps a liquid in millilitres', () => {
    const ml = { name: 'ml', gramsPerServing: 0.913, millilitresPerServing: 1 };
    expect(formatPortionAmount(15, ml)).toBe('15 ml');
    expect(formatPortionAmount(1, { name: '100 ml', gramsPerServing: 91.3, millilitresPerServing: 100 })).toBe('100 ml');
  });

  it('shows an imperial unit’s metric equivalent, because the maths used it', () => {
    expect(formatPortionAmount(6, { name: 'oz', gramsPerServing: GRAMS_PER_OUNCE })).toBe(
      '6 oz (170 g)',
    );
  });
});
