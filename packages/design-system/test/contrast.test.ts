import { describe, expect, it } from 'vitest';

import { contrastRatio, relativeLuminance, reportRatio } from '../src/lib/contrast.js';
import tokens from '../tokens/tokens.json';

/**
 * CI-blocking contrast suite (ADR-0013).
 *
 * The palette cannot change without this file agreeing. Every colour in
 * tokens.json declares a `role`, and the role decides the threshold:
 *
 *   surface     the backgrounds everything else is measured against
 *   text        body text - 4.5:1 against every surface, in both themes
 *   ui          control boundaries and state fills - 3:1 against every surface
 *   on-fill     labels drawn on a fill, measured through `contrast.pairs`
 *   decorative  exempt, and each one carries a written justification in `use`
 *
 * If a pair fails, fix the token. Do not lower a threshold and do not move a
 * colour to `decorative` to make a failure go away.
 */

type Role = 'surface' | 'text' | 'ui' | 'on-fill' | 'decorative';
interface ColorToken {
  role: Role;
  dark: string;
  light: string;
  use: string;
}

const colors = tokens.color as Record<string, ColorToken>;
const THEMES = ['dark', 'light'] as const;
type Theme = (typeof THEMES)[number];

const byRole = (role: Role) => Object.entries(colors).filter(([, v]) => v.role === role);
const surfaces = byRole('surface');
const BODY_TEXT = tokens.contrast.bodyText;
const UI_COMPONENT = tokens.contrast.uiComponent;

describe('relative luminance', () => {
  it('anchors at the two ends of the scale', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
  });

  it('reproduces the WCAG worked example for mid grey', () => {
    // #808080 lineariser output, computed by hand from the WCAG 2.2 formula.
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2158605, 6);
  });

  it('gives black on white the documented 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 6);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#0A1119', '#FF7A33')).toBeCloseTo(contrastRatio('#FF7A33', '#0A1119'), 12);
  });

  it('refuses a translucent colour rather than silently ignoring alpha', () => {
    expect(() => relativeLuminance('#04080Ccc')).toThrow(/opaque/i);
  });
});

describe.each(THEMES)('%s theme', (theme: Theme) => {
  describe('body text is 4.5:1 on every surface (WCAG 2.2 AA, 1.4.3)', () => {
    for (const [textName, text] of byRole('text')) {
      for (const [surfaceName, surface] of surfaces) {
        it(`${textName} on ${surfaceName}`, () => {
          const ratio = contrastRatio(text[theme], surface[theme]);
          expect(
            ratio,
            `${textName} (${text[theme]}) on ${surfaceName} (${surface[theme]}) ` +
              `is ${reportRatio(text[theme], surface[theme])}:1, needs ${BODY_TEXT}:1`,
          ).toBeGreaterThanOrEqual(BODY_TEXT);
        });
      }
    }
  });

  describe('UI component boundaries are 3:1 on every surface (WCAG 2.2 AA, 1.4.11)', () => {
    for (const [uiName, ui] of byRole('ui')) {
      for (const [surfaceName, surface] of surfaces) {
        it(`${uiName} on ${surfaceName}`, () => {
          const ratio = contrastRatio(ui[theme], surface[theme]);
          expect(
            ratio,
            `${uiName} (${ui[theme]}) on ${surfaceName} (${surface[theme]}) ` +
              `is ${reportRatio(ui[theme], surface[theme])}:1, needs ${UI_COMPONENT}:1`,
          ).toBeGreaterThanOrEqual(UI_COMPONENT);
        });
      }
    }
  });

  describe('declared foreground/fill pairs', () => {
    for (const pair of tokens.contrast.pairs) {
      it(`${pair.fg} on ${pair.bg} >= ${pair.min}:1 - ${pair.why}`, () => {
        const fg = colors[pair.fg];
        const bg = colors[pair.bg];
        expect(fg, `unknown token ${pair.fg}`).toBeDefined();
        expect(bg, `unknown token ${pair.bg}`).toBeDefined();
        const ratio = contrastRatio((fg as ColorToken)[theme], (bg as ColorToken)[theme]);
        expect(
          ratio,
          `${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1, needs ${pair.min}:1`,
        ).toBeGreaterThanOrEqual(pair.min);
      });
    }
  });

  it('large text (>=24px, or >=18.66px bold) clears 3:1 wherever body text clears 4.5:1', () => {
    // Implied by the body-text assertions, but stated explicitly so the AA large-text
    // threshold is visible in the suite rather than assumed.
    for (const [, text] of byRole('text')) {
      for (const [, surface] of surfaces) {
        expect(contrastRatio(text[theme], surface[theme])).toBeGreaterThanOrEqual(
          tokens.contrast.largeText,
        );
      }
    }
  });

  it('adjacent surfaces are distinguishable from one another', () => {
    // Not a WCAG requirement and deliberately a low bar: this is an identity check, not a
    // design threshold. A dark gym flattens elevation, so two surfaces resolving to the same
    // colour means the elevation system conveys nothing. Elevation is always reinforced by a
    // hairline or a shadow, so the fills themselves are not asked to do the separating.
    const ordered = surfaces.map(([name, v]) => [name, v[theme]] as const);
    expect(new Set(ordered.map(([, hex]) => hex.toUpperCase())).size).toBe(ordered.length);
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1] as readonly [string, string];
      const curr = ordered[i] as readonly [string, string];
      expect(
        contrastRatio(prev[1], curr[1]),
        `${prev[0]} and ${curr[0]} are visually identical`,
      ).toBeGreaterThan(1.05);
    }
  });
});

describe('IWF plate colours', () => {
  const plates = Object.entries(tokens.plate.iwf);

  it('carve-out is explicit, not accidental', () => {
    // ADR-0013 exempts plate fills from the blueprint palette. The exemption covers the
    // *fill* only; the printed mass must still be readable.
    expect(tokens.plate.$comment).toMatch(/ADR-0013/);
    expect(tokens.plate.outline).toBe('line-strong');
  });

  for (const [key, plate] of plates) {
    it(`${key} (${plate.name}) prints its mass at 4.5:1`, () => {
      const ratio = contrastRatio(plate.label, plate.fill);
      expect(
        ratio,
        `${key} label ${plate.label} on ${plate.fill} is ${reportRatio(plate.label, plate.fill)}:1`,
      ).toBeGreaterThanOrEqual(BODY_TEXT);
    });
  }

  it('every plate is a distinct fill', () => {
    const fills = plates.map(([, p]) => p.fill.toUpperCase());
    expect(new Set(fills).size).toBe(fills.length);
  });

  it.each(THEMES)('the mandated outline separates a plate from the %s surface', (theme: Theme) => {
    // white5 (#E8E8E8) is 1.23:1 against a white surface. Colour alone cannot delimit a
    // plate, which is exactly why tokens.plate.outline is mandatory rather than optional.
    const outline = colors[tokens.plate.outline] as ColorToken;
    for (const [surfaceName, surface] of surfaces) {
      expect(
        contrastRatio(outline[theme], surface[theme]),
        `plate outline on ${surfaceName}`,
      ).toBeGreaterThanOrEqual(UI_COMPONENT);
    }
  });
});

describe('palette hygiene', () => {
  it('every colour declares a role and a stated use', () => {
    for (const [name, token] of Object.entries(colors)) {
      expect(token.role, `${name} has no role`).toBeDefined();
      expect(token.use.length, `${name} has no stated use`).toBeGreaterThan(10);
    }
  });

  it('every decorative exemption is justified in writing', () => {
    // The only way out of the contrast assertions is `decorative`, so that escape hatch
    // has to cost something: a sentence saying why the colour carries no information.
    for (const [name, token] of byRole('decorative')) {
      expect(token.use.length, `${name} is exempt without a justification`).toBeGreaterThan(30);
    }
  });

  it('defines both themes for every colour', () => {
    for (const [name, token] of Object.entries(colors)) {
      expect(token.dark, `${name} has no dark value`).toMatch(/^#[0-9a-fA-F]{6,8}$/);
      expect(token.light, `${name} has no light value`).toMatch(/^#[0-9a-fA-F]{6,8}$/);
    }
  });
});
