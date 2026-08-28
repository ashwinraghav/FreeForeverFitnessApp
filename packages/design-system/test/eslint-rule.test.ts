import { describe, expect, it } from 'vitest';

// @ts-expect-error - the shareable rule ships as plain ESM JS so consumers need no build step.
import { findRawLiterals, looksLikeStyleValue } from '../eslint/detect.js';

/**
 * The mechanical half of ADR-0021.
 *
 * The rule's detection core is tested directly rather than through ESLint's
 * RuleTester, so the definition of "raw literal" is pinned by tests that other
 * tooling can reuse, and so this suite does not depend on an ESLint version.
 */

const kinds = (text: string, styleContext = false): string[] =>
  findRawLiterals(text, { styleContext }).map((hit: { value: string }) => hit.value);

describe('raw colour literals', () => {
  it.each(['#FF7A33', '#fff', '#0A1119aa', 'color: #C4342E;'])('flags %s anywhere', (input) => {
    expect(findRawLiterals(input).length).toBeGreaterThan(0);
  });

  it.each(['rgb(0 0 0)', 'rgba(10,20,30,.4)', 'hsl(20 100% 50%)', 'oklch(70% .2 40)'])(
    'flags the colour function %s',
    (input) => {
      expect(findRawLiterals(input).length).toBeGreaterThan(0);
    },
  );

  it('does not flag a URL fragment', () => {
    expect(kinds('https://example.com/#anchor')).toEqual([]);
  });

  it('does not flag a token reference', () => {
    expect(kinds('var(--ff-color-accent)')).toEqual([]);
  });
});

describe('raw lengths and durations', () => {
  it('flags them in a style position', () => {
    expect(kinds('90s', true)).toEqual(['90s']);
    expect(kinds('16px', true)).toEqual(['16px']);
  });

  it('flags them when the string reads like CSS', () => {
    expect(kinds('padding: 16px;')).toEqual(['16px']);
    expect(kinds('transition: opacity 180ms ease')).toEqual(['180ms']);
  });

  it('leaves user-facing copy alone', () => {
    // A rule that flags "Rest 90s" gets switched off, and then it enforces nothing.
    expect(kinds('Rest 90s')).toEqual([]);
    expect(kinds('You logged 12 sets in 45s of rest')).toEqual([]);
  });

  it('permits zero, which is zero in every scale', () => {
    expect(kinds('0px', true)).toEqual([]);
    expect(kinds('0ms', true)).toEqual([]);
  });

  it('accepts token references in a style position', () => {
    expect(kinds('var(--ff-space-16)', true)).toEqual([]);
    expect(kinds('padding: var(--ff-space-16);')).toEqual([]);
  });

  it('reports several violations in one string', () => {
    expect(kinds('border: 1px solid #0A1119; transition: 240ms')).toEqual(
      expect.arrayContaining(['#0A1119', '1px', '240ms']),
    );
  });
});

describe('style-context heuristic', () => {
  it('recognises a declaration', () => {
    expect(looksLikeStyleValue('margin: 4px')).toBe(true);
  });

  it('recognises a bare length', () => {
    expect(looksLikeStyleValue('12px')).toBe(true);
  });

  it('does not treat prose as a style value', () => {
    expect(looksLikeStyleValue('Rest 90s between sets')).toBe(false);
  });
});

describe('the allow escape hatch', () => {
  it('is opt-in and explicit', () => {
    expect(findRawLiterals('#0A1119', { allow: [/^#0A1119$/] })).toEqual([]);
  });
});
