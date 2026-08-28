import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { color, colorVar, duration, easing, hit, plates, radius, space, type } from '../dist/tokens.js';
import tokens from '../tokens/tokens.json';

/**
 * The anti-drift suite (ADR-0021).
 *
 * Three artefacts are generated from tokens.json - a stylesheet, a typed module and a
 * Tailwind theme block - and the whole point of generating them is that they cannot
 * disagree. This asserts they don't, which also catches the case where someone edits
 * a file in dist/ by hand instead of the source.
 */

/**
 * Paths are built with `path.join` on a `fileURLToPath(import.meta.url)` dirname,
 * never with `new URL('./relative', import.meta.url)`.
 *
 * Vite statically rewrites the `new URL(..., import.meta.url)` pattern into an asset
 * URL - under Vitest that becomes `http://localhost:3000/...`, so `fileURLToPath`
 * throws "The URL must be of scheme file" and the suite fails to collect. The
 * template-literal form is worse: it hits Vite's glob transform and silently yields
 * the wrong content instead of throwing. `fileURLToPath(import.meta.url)` on its own
 * is not part of that pattern and is left alone.
 */
const here = dirname(fileURLToPath(import.meta.url));

const read = (name: string) => readFileSync(join(here, '..', 'dist', name), 'utf8');

const tokensCss = read('tokens.css');
const themeCss = read('theme.css');
const colorEntries = Object.entries(tokens.color);

describe('dist/tokens.css', () => {
  it('defines the complete palette on bare :root, so an un-stamped document still works', () => {
    const bareRoot = tokensCss.slice(tokensCss.indexOf(':root {'), tokensCss.indexOf('@media'));
    for (const [name, value] of colorEntries) {
      expect(bareRoot, `${name} is not defined on bare :root`).toContain(
        `--ff-color-${name}: ${value.light};`,
      );
    }
  });

  it('guards the dark media query so an explicit light choice wins', () => {
    expect(tokensCss).toContain('@media (prefers-color-scheme: dark)');
    expect(tokensCss).toContain(':root:not([data-theme="light"])');
  });

  it('provides an explicit dark selector that beats a light OS preference', () => {
    expect(tokensCss).toContain(':root[data-theme="dark"]');
  });

  it('redefines every colour in both dark blocks', () => {
    // Slice from the real media query, not from the header comment that describes it.
    const darkBlocks = tokensCss.slice(tokensCss.indexOf('@media (prefers-color-scheme: dark)'));
    expect(darkBlocks).toContain(':root[data-theme="dark"]');
    for (const [name, value] of colorEntries) {
      expect(darkBlocks, `${name} missing from the dark blocks`).toContain(
        `--ff-color-${name}: ${value.dark};`,
      );
    }
  });

  it('sets tabular numerals on the root - every number here is compared to another', () => {
    expect(tokensCss).toContain('font-variant-numeric: tabular-nums;');
  });

  it('emits the type scale in rem, so it survives a 200% text setting', () => {
    for (const [name, step] of Object.entries(tokens.type)) {
      expect(tokensCss).toContain(`--ff-text-${name}: ${step.px / 16}rem;`);
    }
  });

  it('emits hit targets in px, because a thumb does not scale with the root font size', () => {
    for (const [name, value] of Object.entries(tokens.hit)) {
      expect(tokensCss).toContain(`--ff-hit-${name}: ${value.px}px;`);
    }
  });

  it('carries a do-not-edit banner', () => {
    expect(tokensCss).toContain('GENERATED FILE - DO NOT EDIT');
  });
});

describe('dist/tokens.ts', () => {
  it('agrees with the source on every colour, in both themes', () => {
    for (const [name, value] of colorEntries) {
      expect(color.dark[name as keyof typeof color.dark]).toBe(value.dark);
      expect(color.light[name as keyof typeof color.light]).toBe(value.light);
    }
  });

  it('exposes a var() reference for every colour', () => {
    for (const [name] of colorEntries) {
      expect(colorVar[name as keyof typeof colorVar]).toBe(`var(--ff-color-${name})`);
    }
  });

  it('agrees on the space, radius, hit and motion scales', () => {
    for (const [name, value] of Object.entries(tokens.space)) {
      expect(space[name as keyof typeof space]).toBe(value.px);
    }
    for (const [name, value] of Object.entries(tokens.radius)) {
      expect(radius[name as keyof typeof radius]).toBe(value.px);
    }
    for (const [name, value] of Object.entries(tokens.hit)) {
      expect(hit[name as keyof typeof hit]).toBe(value.px);
    }
    for (const [name, value] of Object.entries(tokens.motion.duration)) {
      expect(duration[name as keyof typeof duration]).toBe(value.ms);
    }
    expect(easing.standard).toBe(tokens.motion.easing.standard.value);
  });

  it('agrees on the type scale, in px and rem', () => {
    for (const [name, step] of Object.entries(tokens.type)) {
      const emitted = type[name as keyof typeof type];
      expect(emitted.px).toBe(step.px);
      expect(emitted.rem).toBe(`${step.px / 16}rem`);
      expect(emitted.weight).toBe(step.weight);
    }
  });

  it('agrees on the plate set and keeps it descending for a greedy load solve', () => {
    for (const [name, plate] of Object.entries(tokens.plate.iwf)) {
      expect(plates[name as keyof typeof plates].fill).toBe(plate.fill);
      expect(plates[name as keyof typeof plates].kg).toBe(plate.kg);
    }
    const masses = Object.values(plates).map((plate) => plate.kg);
    expect([...masses].sort((a, b) => b - a)).toEqual(masses.slice().sort((a, b) => b - a));
  });
});

describe('dist/theme.css', () => {
  it('maps every colour into Tailwind’s --color-* namespace via var(), not a literal', () => {
    for (const [name] of colorEntries) {
      expect(themeCss).toContain(`--color-${name}: var(--ff-color-${name});`);
    }
  });

  it('clears the stock palette and spacing scale, so bg-red-500 and p-7 stop existing', () => {
    // This is the mechanism behind ADR-0021 on the utility-class side: a raw value
    // cannot sneak in through Tailwind if the stock scales are not there.
    expect(themeCss).toContain('--color-*: initial;');
    expect(themeCss).toContain('--spacing-*: initial;');
  });

  it('exposes the spacing and hit scales', () => {
    for (const [name] of Object.entries(tokens.space)) {
      expect(themeCss).toContain(`--spacing-${name}: var(--ff-space-${name});`);
    }
    for (const [name] of Object.entries(tokens.hit)) {
      expect(themeCss).toContain(`--spacing-hit-${name}: var(--ff-hit-${name});`);
    }
  });
});
