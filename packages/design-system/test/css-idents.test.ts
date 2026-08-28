import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { plateVar, plates } from '../dist/tokens.js';
import tokens from '../tokens/tokens.json';

/**
 * Every emitted CSS custom-property name must be a valid ident.
 *
 * This exists because five plate colours shipped as `--ff-plate-kg-2.5-fill`. An
 * unescaped `.` is not valid in a <dashed-ident>: it terminates the ident, so the
 * declaration is a syntax error and every `var()` pointing at it resolves to nothing.
 * Nothing caught it. The TS export was correct, so the one consuming team saw working
 * colours; the only signal was `[WARNING] Expected ":"` buried in `vite build`.
 *
 * That is the same shape of problem as the contrast suite: a mechanical property of
 * the emitted output that no human will re-check, and that fails silently rather than
 * loudly. So it is asserted, over the emitted artefacts rather than over the source,
 * because the emitter is where the mistake was.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, '..', path), 'utf8');

/** <custom-property-name>: `--` followed by ident chars. ASCII-only, deliberately. */
const VALID = /^--[A-Za-z0-9_-]+$/;
/** `--color-*: initial` is Tailwind v4 namespace-reset syntax, not a property name. */
const NAMESPACE_RESET = /^--[A-Za-z0-9_-]*\*$/;

const isAcceptable = (name: string) => VALID.test(name) || NAMESPACE_RESET.test(name);

const declaredIn = (source: string) =>
  [...source.matchAll(/^\s*(--[^\s:]+)\s*:/gm)].map((m) => m[1] as string);

const referencedIn = (source: string) =>
  [...source.matchAll(/var\(\s*(--[^\s,)]+)/g)].map((m) => m[1] as string);

const ARTEFACTS = [
  'dist/tokens.css',
  'dist/theme.css',
  // Not CSS, but the var() strings it hands to callers are.
  'dist/tokens.ts',
  'src/styles/primitives.css',
] as const;

describe.each(ARTEFACTS)('%s', (path) => {
  const source = read(path);

  it('declares only valid custom-property names', () => {
    const invalid = declaredIn(source).filter((name) => !isAcceptable(name));
    expect(invalid).toEqual([]);
  });

  it('references only valid custom-property names', () => {
    // A reference to an unparseable name is exactly as dead as the declaration, and
    // is how theme.css stayed broken after the Tailwind-side name was fixed.
    const invalid = referencedIn(source).filter((name) => !isAcceptable(name));
    expect(invalid).toEqual([]);
  });

  it('contains no unescaped dot in any custom-property name', () => {
    // Stated separately from the ident regex so a failure names the actual defect.
    const dotted = [...declaredIn(source), ...referencedIn(source)].filter((name) =>
      name.includes('.'),
    );
    expect(dotted).toEqual([]);
  });
});

describe('every var() reference resolves to a declared token', () => {
  const declared = new Set([
    ...declaredIn(read('dist/tokens.css')),
    ...declaredIn(read('src/styles/primitives.css')),
  ]);

  it.each(['dist/theme.css', 'dist/tokens.ts', 'src/styles/primitives.css'])(
    '%s points at nothing undefined',
    (path) => {
      const dangling = [...new Set(referencedIn(read(path)))]
        .filter((name) => name.startsWith('--ff-'))
        .filter((name) => !declared.has(name));
      expect(dangling).toEqual([]);
    },
  );
});

describe('fractional plate keys', () => {
  const fractional = Object.keys(tokens.plate.iwf).filter((key) => key.includes('.'));

  it('exist - otherwise this suite is guarding nothing', () => {
    expect(fractional).toEqual(['kg-2.5', 'kg-1.25', 'kg-0.5']);
  });

  it.each(fractional)('%s is emitted with the dot translated to an underscore', (key) => {
    const css = read('dist/tokens.css');
    const ident = key.replace(/\./g, '_');
    expect(css).toContain(`--ff-plate-${ident}-fill:`);
    expect(css).toContain(`--ff-plate-${ident}-label:`);
    expect(css).not.toContain(`--ff-plate-${key}-fill:`);
  });

  it('keeps the dotted key in the TS export, which is a JS key and is fine', () => {
    // The keys are the published TS API and are already in use; only the CSS spelling
    // changed. `plates` and `plateVar` stay keyed identically so the two cannot drift.
    expect(Object.keys(plateVar)).toEqual(Object.keys(plates));
  });
});

describe('plateVar', () => {
  it('gives a reference for every plate, so nobody hand-writes the CSS name', () => {
    for (const [key, plate] of Object.entries(tokens.plate.iwf)) {
      const ident = key.replace(/\./g, '_');
      const entry = plateVar[key as keyof typeof plateVar];
      expect(entry.fill).toBe(`var(--ff-plate-${ident}-fill)`);
      expect(entry.label).toBe(`var(--ff-plate-${ident}-label)`);
      // And the reference must point at the colour the token file actually declares.
      expect(read('dist/tokens.css')).toContain(`--ff-plate-${ident}-fill: ${plate.fill};`);
    }
  });
});

describe('border widths are public vocabulary', () => {
  it('are declared as real tokens rather than private implementation detail', () => {
    expect(tokens.border.hairline.px).toBe(1);
    expect(tokens.border.strong.px).toBe(2);
    expect(read('dist/tokens.css')).toContain('--ff-border-hairline: 1px;');
    expect(read('dist/tokens.css')).toContain('--ff-border-strong: 2px;');
  });

  it('are exposed to Tailwind consumers too', () => {
    expect(read('dist/theme.css')).toContain('--border-hairline: var(--ff-border-hairline);');
  });

  it('are used by the primitives without a literal fallback', () => {
    // A `var(--x, 1px)` fallback in a stylesheet is a raw literal wearing a disguise.
    const css = read('src/styles/primitives.css');
    expect(css).not.toMatch(/var\(--ff-border-hairline,/);
    expect(css).not.toMatch(/var\(--ff-border-strong,/);
  });
});
