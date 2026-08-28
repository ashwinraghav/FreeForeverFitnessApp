import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@freeforever/design-system';
import { colorFor, type ThemeName } from '@freeforever/design-system/tokens';
import {
  HEAT_STOPS,
  fallbackInk,
  heatRamp,
  heatVariables,
  mixOklab,
  readChartInk,
} from '../charts/palette';


/**
 * The heat ramp is the only thing in this feature encoded by colour, so it is the
 * only thing that needs a colour test — and it gets a real one rather than a
 * screenshot.
 *
 * These assertions are the data-viz ordinal checks, transcribed. They passed when the
 * stops were chosen; pinning them here is what stops a future token change from
 * quietly dropping a step below the visibility floor, which is exactly the kind of
 * regression nobody notices until someone with low vision reports it.
 */



/** OKLCH lightness — the axis an ordinal ramp has to be monotone along. */
function lightness(hex: string): number {
  const parse = (i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [lin(parse(0)), lin(parse(1)), lin(parse(2))];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

const rampFor = (theme: ThemeName): readonly string[] =>
  heatRamp(colorFor(theme, 'accent'), colorFor(theme, 'sunken'));

describe('heat ramp', () => {
  it('matches CSS color-mix in oklab', () => {
    // Sanity check on the mixer itself: a 100% mix is the source colour, a 0% mix is
    // the destination, and the midpoint is neither.
    expect(mixOklab('#ff7a33', '#1e2f3e', 100)).toBe('#ff7a33');
    expect(mixOklab('#ff7a33', '#1e2f3e', 0)).toBe('#1e2f3e');
    expect(mixOklab('#ff7a33', '#1e2f3e', 34)).toBe('#684b45');
  });

  it('reads a resolved rgb() as well as a hex, because getComputedStyle returns rgb', () => {
    expect(mixOklab('rgb(255, 122, 51)', 'rgb(30, 47, 62)', 34)).toBe('#684b45');
  });

  it.each(['dark', 'light'] as const)('is monotone in lightness in the %s theme', (theme) => {
    const levels = rampFor(theme).map(lightness);
    const deltas = levels.slice(1).map((value, index) => value - (levels[index] ?? 0));
    const sign = Math.sign(deltas[0] ?? 0);
    for (const delta of deltas) {
      expect(Math.sign(delta)).toBe(sign);
      // An adjacent gap below 0.06 is a step the eye cannot resolve.
      expect(Math.abs(delta)).toBeGreaterThanOrEqual(0.06);
    }
  });

  it.each(['dark', 'light'] as const)(
    'keeps the faintest step visible against the card surface in the %s theme',
    (theme) => {
      const faintest = rampFor(theme)[0] ?? '';
      expect(contrastRatio(faintest, colorFor(theme, 'surface'))).toBeGreaterThanOrEqual(2);
    },
  );

  it('pins the validated stops', () => {
    expect(HEAT_STOPS).toEqual([34, 56, 78, 100]);
    expect(rampFor('dark')).toEqual(['#684b45', '#985c45', '#cb6b40', '#ff7a33']);
    expect(rampFor('light')).toEqual(['#d0ada6', '#c78b79', '#ba694c', '#ac4316']);
  });

  it('emits the body map custom properties from the same one constant', () => {
    const variables = heatVariables();
    // The body map paints from these; the stylesheet declares no ramp of its own,
    // so there is no second copy that could drift away from HEAT_STOPS.
    expect(variables['--ff-in-heat-0']).toBe('var(--ff-color-sunken)');
    for (const [index, stop] of HEAT_STOPS.entries()) {
      expect(variables[`--ff-in-heat-${index + 1}`]).toBe(
        `color-mix(in oklab, var(--ff-color-accent) ${stop}%, var(--ff-color-sunken))`,
      );
    }
    // Every step the stylesheet references has a value.
    expect(Object.keys(variables)).toHaveLength(5);
  });
});

describe('chart ink', () => {
  it('falls back to the dark theme when there is no cascade to read', () => {
    const ink = readChartInk(null);
    expect(ink).toEqual(fallbackInk('dark'));
    expect(ink.accent).toBe(colorFor('dark', 'accent'));
  });

  it('takes each token from the element it is asked about', () => {
    const values: Record<string, string> = {
      '--ff-color-accent': 'rgb(172, 67, 22)',
      '--ff-color-sunken': 'rgb(219, 226, 236)',
      '--ff-color-surface': 'rgb(255, 255, 255)',
    };
    const original = globalThis.getComputedStyle;
    Object.defineProperty(globalThis, 'getComputedStyle', {
      configurable: true,
      value: () => ({ getPropertyValue: (name: string) => values[name] ?? '' }),
    });
    try {
      const ink = readChartInk({} as Element);
      expect(ink.accent).toBe('rgb(172, 67, 22)');
      expect(ink.sunken).toBe('rgb(219, 226, 236)');
      // The ramp derives from those two, and matches the light theme's validated steps.
      expect(heatRamp(ink.accent, ink.sunken)).toEqual(rampFor('light'));
      // A token the cascade does not supply falls back rather than rendering blank.
      expect(ink.fgPrimary).toBe(colorFor('dark', 'fg-primary'));
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(globalThis, 'getComputedStyle');
      } else {
        Object.defineProperty(globalThis, 'getComputedStyle', {
          configurable: true,
          value: original,
        });
      }
    }
  });
});

describe('no raw literals leak into the feature (ADR-0021)', () => {
  const sources = import.meta.glob('../**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  it('has no hex colour outside the palette module and its test', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes('charts/palette.ts') && !/\.test\.tsx?$/.test(path))
      .filter(([, source]) => /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/i.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('emits no px or duration literal into a string or template', () => {
    // The repo-wide ESLint rule is the real enforcement; this catches the same thing
    // one layer earlier, where it is a failing test in this package's own suite.
    // Numeric constants and prose in comments are not violations and are not matched.
    const inQuotes = /(['"`])[^'"`\n]*(?<![\w.#-])(?!0)\d*\.?\d+(?:px|ms)\b[^'"`\n]*\1/g;
    const offenders = Object.entries(sources)
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .flatMap(([path, source]) => (source.match(inQuotes) ?? []).map((hit) => `${path}: ${hit}`));
    expect(offenders).toEqual([]);
  });
});
