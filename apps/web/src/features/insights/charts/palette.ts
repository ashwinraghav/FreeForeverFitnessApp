import { colorFor } from '@freeforever/design-system/tokens';
import type { ColorName } from '@freeforever/design-system/tokens';

/**
 * Chart ink.
 *
 * Canvas cannot read a CSS custom property, so something has to resolve tokens to
 * concrete colours. Two ways exist and only one of them is right here.
 *
 * `colorFor(theme, name)` needs the feature to *decide* which theme is active, and
 * the theme has three states (ADR-0013): an explicit `data-theme`, or nothing at all
 * plus the OS preference. Any code that guesses gets the third state wrong.
 *
 * So this reads the custom properties off the live element the chart is mounted in.
 * The browser has already resolved the cascade, so whatever the document is actually
 * showing is what the canvas gets, including a theme switch mid-session. `colorFor`
 * supplies the fallback for the one case where there is no cascade to read — a test
 * runner, or a first paint before styles land.
 */

export interface ChartInk {
  /** The single signal colour. The data, and only the data. */
  readonly accent: string;
  /** De-emphasis series and axis rules. Held to 3:1 against every surface. */
  readonly lineStrong: string;
  /** Gridlines. Decorative by role, one step off the surface, exactly as intended. */
  readonly hairline: string;
  readonly fgPrimary: string;
  readonly fgSecondary: string;
  readonly fgMuted: string;
  /** The chart's own background, used for the surface gaps and the marker rings. */
  readonly surface: string;
  readonly sunken: string;
}

const TOKEN_BY_KEY = {
  accent: 'accent',
  lineStrong: 'line-strong',
  hairline: 'hairline',
  fgPrimary: 'fg-primary',
  fgSecondary: 'fg-secondary',
  fgMuted: 'fg-muted',
  surface: 'surface',
  sunken: 'sunken',
} as const satisfies Record<string, ColorName>;

/**
 * Mix stops for the heat ramp, as a percentage of accent against `sunken`.
 *
 * These four values are the whole ramp and they are not taste. They were chosen by
 * running the data-viz ordinal checks over both themes: monotone lightness, an
 * adjacent lightness gap of at least 0.06, a hue spread under 40 degrees, and the
 * faintest step clearing 2:1 against the chart surface. A floor of 34% is what makes
 * the faintest step visible on `surface` in *both* themes — below it the light theme
 * fades into the card. `test/palette.test.ts` pins the resulting hexes, so a token
 * change that drops a step below the floor fails CI rather than shipping.
 *
 * This constant is the ONE definition. The stylesheet does not repeat it: the custom
 * properties the body map paints with are emitted from here by `heatVariables()` and
 * applied to the feature root, so there is no second copy to drift.
 */
export const HEAT_STOPS = [34, 56, 78, 100] as const;

// -- oklab mixing, matching CSS `color-mix(in oklab, …)` ------------------------

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;

function parseColor(value: string): readonly [number, number, number] | null {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text);
  if (hex !== null) {
    const digits = hex[1] ?? '';
    const expand = digits.length <= 4 ? digits.slice(0, 3).replace(/./g, (d) => d + d) : digits;
    if (expand.length < 6) return null;
    return [0, 2, 4].map((i) => parseInt(expand.slice(i, i + 2), 16) / 255) as unknown as [
      number,
      number,
      number,
    ];
  }
  // getComputedStyle hands back `rgb(r g b)` or `rgb(r, g, b)` for a resolved colour.
  const parts = text.match(/-?\d*\.?\d+/g);
  if (parts === null || parts.length < 3) return null;
  return [Number(parts[0]) / 255, Number(parts[1]) / 255, Number(parts[2]) / 255];
}

function toOklab([r, g, b]: readonly [number, number, number]): [number, number, number] {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: readonly [number, number, number]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channels = [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
  return `#${channels
    .map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** The TypeScript twin of `color-mix(in oklab, from percent%, to)`. */
export function mixOklab(from: string, to: string, percent: number): string {
  const a = parseColor(from);
  const b = parseColor(to);
  if (a === null || b === null) return from;
  const left = toOklab(a);
  const right = toOklab(b);
  const t = Math.min(1, Math.max(0, percent / 100));
  return fromOklab([
    left[0] * t + right[0] * (1 - t),
    left[1] * t + right[1] * (1 - t),
    left[2] * t + right[2] * (1 - t),
  ]);
}

/**
 * The four ordinal steps, faintest first.
 *
 * Nothing draws with this at runtime — the body map paints from the custom properties
 * `heatVariables()` emits, so the ramp follows the theme through the cascade. It
 * exists so the ramp's accessibility properties can be asserted as arithmetic in
 * `test/palette.test.ts` rather than eyeballed in a screenshot.
 */
export function heatRamp(
  accent: string,
  sunken: string,
): readonly [string, string, string, string] {
  const [a, b, c, d] = HEAT_STOPS;
  return [
    mixOklab(accent, sunken, a),
    mixOklab(accent, sunken, b),
    mixOklab(accent, sunken, c),
    mixOklab(accent, sunken, d),
  ];
}

/** Dark is the design direction (ADR-0013), so it is also the no-cascade fallback. */
export function fallbackInk(theme: 'dark' | 'light' = 'dark'): ChartInk {
  const read = (name: ColorName): string => colorFor(theme, name);
  return {
    accent: read('accent'),
    lineStrong: read('line-strong'),
    hairline: read('hairline'),
    fgPrimary: read('fg-primary'),
    fgSecondary: read('fg-secondary'),
    fgMuted: read('fg-muted'),
    surface: read('surface'),
    sunken: read('sunken'),
  };
}

/**
 * Resolve the ink for whatever theme `element` is actually rendering in.
 *
 * Any token that comes back empty falls back rather than throwing: a chart that
 * disappears because one custom property was missing is a worse failure than a chart
 * drawn in the fallback theme's ink.
 */
export function readChartInk(element: Element | null): ChartInk {
  const fallback = fallbackInk();
  if (element === null || typeof globalThis.getComputedStyle !== 'function') return fallback;

  const style = globalThis.getComputedStyle(element);
  const read = (key: keyof typeof TOKEN_BY_KEY): string => {
    const value = style.getPropertyValue(`--ff-color-${TOKEN_BY_KEY[key]}`).trim();
    return value === '' ? fallback[key] : value;
  };

  return {
    accent: read('accent'),
    lineStrong: read('lineStrong'),
    hairline: read('hairline'),
    fgPrimary: read('fgPrimary'),
    fgSecondary: read('fgSecondary'),
    fgMuted: read('fgMuted'),
    surface: read('surface'),
    sunken: read('sunken'),
  };
}

/**
 * The heat ramp as CSS custom properties, for the SVG body map.
 *
 * Emitted as `color-mix()` expressions over the two tokens rather than as resolved
 * hexes, so they follow the theme through the cascade exactly like every other colour
 * in the app — no JS re-resolve on a theme switch, and no first-paint flash of the
 * wrong theme's ramp while an effect catches up.
 */
export function heatVariables(): Record<string, string> {
  const mix = (stop: number): string =>
    `color-mix(in oklab, var(--ff-color-accent) ${stop}%, var(--ff-color-sunken))`;
  return {
    '--ff-in-heat-0': 'var(--ff-color-sunken)',
    '--ff-in-heat-1': mix(HEAT_STOPS[0]),
    '--ff-in-heat-2': mix(HEAT_STOPS[1]),
    '--ff-in-heat-3': mix(HEAT_STOPS[2]),
    '--ff-in-heat-4': mix(HEAT_STOPS[3]),
  };
}
