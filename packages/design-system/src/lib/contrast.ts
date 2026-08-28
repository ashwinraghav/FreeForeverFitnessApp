/**
 * WCAG 2.2 relative luminance and contrast ratio.
 *
 * Implemented here rather than pulled from a dependency because this is the
 * function that decides whether the palette ships (ADR-0013): it is asserted in
 * CI, so it has to be readable and auditable in the repository.
 *
 * Reference: WCAG 2.2, "relative luminance" and "contrast ratio" definitions.
 */

/** An `#rgb`, `#rrggbb` or `#rrggbbaa` colour. Alpha is ignored - see `parseHex`. */
export type Hex = string;

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * Parse a hex colour to 0-255 channels.
 *
 * An alpha channel is *rejected* rather than ignored: a translucent colour has no
 * single contrast ratio, it depends on what is behind it. Composite it first.
 */
export function parseHex(hex: Hex): Rgb {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    throw new Error(
      `Not an opaque hex colour: ${JSON.stringify(hex)}. ` +
        `Composite translucent colours against their backdrop before measuring contrast.`,
    );
  }
  const body = m[1] as string;
  const full =
    body.length === 3
      ? body
          .split('')
          .map((c) => c + c)
          .join('')
      : body;
  const n = Number.parseInt(full, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** Linearise one sRGB channel (WCAG 2.2 step 1). */
function linearise(channel8Bit: number): number {
  const c = channel8Bit / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: Hex): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/** Contrast ratio, 1 to 21. Order-independent. */
export function contrastRatio(a: Hex, b: Hex): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Rounded down to 2dp, so a reported figure never overstates the real ratio. */
export function reportRatio(a: Hex, b: Hex): string {
  return (Math.floor(contrastRatio(a, b) * 100) / 100).toFixed(2);
}
