import { describe, expect, it } from 'vitest';
import {
  formatEnergy,
  formatGrams,
  formatMillilitres,
  formatMilligrams,
  formatPercent,
  formatPortion,
  formatQuantity,
  formatRemaining,
  KILOJOULES_PER_KILOCALORIE,
} from './format.js';
import { GRAMS_PER_OUNCE } from './portions.js';

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
