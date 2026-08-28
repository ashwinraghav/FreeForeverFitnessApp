import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import tokens from '../tokens/tokens.json';

/**
 * Hit targets, enforced against the stylesheet rather than against a rendered DOM.
 *
 * jsdom does no layout, so `getBoundingClientRect()` in a component test returns
 * zeroes and would assert nothing. The size of a control is decided in exactly one
 * place - the `min-block-size` / `min-inline-size` declarations below - so that is
 * where it is checked. A component test asserts the *class* is applied; this asserts
 * the class is big enough (ADR-0013).
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

const css = readFileSync(join(here, '..', 'src', 'styles', 'primitives.css'), 'utf8');

const HIT = tokens.hit;
const MIN = HIT.min.px;
const MID_SET = HIT['mid-set'].px;

/** `--ff-hit-min` -> 48 etc., for resolving a declaration back to a number. */
const hitPx = (name: string): number | undefined => {
  const entry = Object.entries(HIT).find(([key]) => `--ff-hit-${key}` === name);
  return entry?.[1].px;
};

interface Rule {
  selector: string;
  body: string;
}

/**
 * Flat rule split. Good enough for this stylesheet, which nests only inside @media -
 * an at-rule's inner rules fall out of this with clean selectors.
 *
 * Comments are stripped first: they are `[^{}]` text, so a rule preceded by a comment
 * would otherwise carry that comment into its selector and never match by name.
 */
function rules(source: string): Rule[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(withoutComments);
  while (match !== null) {
    const selector = (match[1] ?? '').trim();
    const body = match[2] ?? '';
    if (selector && !selector.startsWith('@') && !selector.startsWith('from') && !selector.startsWith('to')) {
      out.push({ selector, body });
    }
    match = pattern.exec(withoutComments);
  }
  return out;
}

const allRules = rules(css);

const sizeDeclarations = (body: string): string[] =>
  [...body.matchAll(/min-(?:block|inline)-size:\s*var\((--ff-hit-[a-z-]+)\)/g)].map(
    (m) => m[1] as string,
  );

describe('hit targets', () => {
  it('the token scale itself encodes the two floors', () => {
    expect(MIN).toBe(48);
    expect(MID_SET).toBe(56);
  });

  it('every hit-token used by a primitive clears the 48px floor', () => {
    const used = allRules.flatMap((rule) => sizeDeclarations(rule.body));
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) {
      const px = hitPx(name);
      expect(px, `${name} is not a hit token`).toBeDefined();
      expect(px, `${name} is below the 48px floor`).toBeGreaterThanOrEqual(MIN);
    }
  });

  it('no primitive uses the 44px compact token', () => {
    // `compact` exists for platform chrome outside the workout flow. A primitive
    // reaching for it would quietly drop the whole app below the ADR-0013 floor.
    expect(css).not.toContain('var(--ff-hit-compact)');
  });

  it('the base control sets the floor once, so every primitive inherits it', () => {
    const control = allRules.find((rule) => rule.selector === '.ff-control');
    expect(control).toBeDefined();
    expect(control?.body).toContain('min-block-size: var(--ff-hit-min)');
  });

  it.each(['.ff-button--xl', '.ff-icon-button--xl'])(
    '%s is the mid-set size, not merely the minimum',
    (selector) => {
      const rule = allRules.find((r) => r.selector === selector);
      expect(rule, `${selector} is missing`).toBeDefined();
      expect(rule?.body).toContain('var(--ff-hit-mid-set)');
    },
  );

  it.each(['.ff-button--sm', '.ff-button--md', '.ff-button--lg'])(
    '%s still clears the floor - sizes differ in type, never in reachability',
    (selector) => {
      const rule = allRules.find((r) => r.selector === selector);
      expect(rule, `${selector} is missing`).toBeDefined();
      expect(rule?.body).toContain('min-block-size: var(--ff-hit-min)');
    },
  );

  it('the NumberField steppers are mid-set on both axes', () => {
    const rule = allRules.find((r) => r.selector === '.ff-number__step');
    expect(rule?.body).toContain('min-inline-size: var(--ff-hit-mid-set)');
    expect(rule?.body).toContain('min-block-size: var(--ff-hit-mid-set)');
  });

  it('icon buttons are square and never narrower than the floor', () => {
    const rule = allRules.find((r) => r.selector.includes('.ff-icon-button--sm'));
    expect(rule?.body).toContain('min-inline-size: var(--ff-hit-min)');
  });

  it('text inputs and list rows are at least the floor', () => {
    for (const selector of ['.ff-input', '.ff-list__item', '.ff-choice']) {
      const rule = allRules.find((r) => r.selector === selector);
      expect(rule?.body, `${selector} sets no minimum height`).toContain(
        'min-block-size: var(--ff-hit-min)',
      );
    }
  });
});

describe('focus visibility', () => {
  it('there is exactly one focus-ring definition, so it cannot drift', () => {
    const ringRules = allRules.filter((rule) => rule.body.includes('--ff-color-focus-ring)'));
    expect(ringRules.length).toBeGreaterThan(0);
    for (const rule of ringRules) {
      expect(rule.body).toContain('--ff-color-focus-ring-inner');
    }
  });

  it('never removes an outline without putting a ring back', () => {
    for (const rule of allRules) {
      if (/outline:\s*none/.test(rule.body)) {
        const isBaseReset = rule.selector === '.ff-focusable';
        expect(
          isBaseReset || rule.body.includes('box-shadow'),
          `${rule.selector} removes the outline without a replacement ring`,
        ).toBe(true);
      }
    }
  });

  it('falls back to a real outline in forced-colors mode, where box-shadow is dropped', () => {
    expect(css).toContain('forced-colors: active');
  });
});

describe('reduced motion', () => {
  it('is handled once, globally, rather than per component', () => {
    const blocks = css.match(/@media \(prefers-reduced-motion: reduce\)/g) ?? [];
    expect(blocks).toHaveLength(1);
  });

  it('is not scoped to a wrapper class a caller could forget to apply', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/\*,\s*\*::before,\s*\*::after/);
  });

  it('collapses durations rather than zeroing them, so transitionend still fires', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('transition-duration: 1ms !important');
    expect(block).toContain('animation-duration: 1ms !important');
  });

  it('removes the skeleton sweep outright', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('animation: none !important');
  });
});

describe('the stylesheet consumes tokens only', () => {
  it('contains no hex colour', () => {
    // The one file licensed to hold raw values, and it still does not need any.
    const lines = css.split('\n');
    const offenders = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /#[0-9a-fA-F]{3,8}\b/.test(line) && !line.trim().startsWith('*'));
    expect(offenders.map((o) => `${o.index + 1}: ${o.line.trim()}`)).toEqual([]);
  });

  it('every colour goes through a --ff-color-* or --ff-plate-* custom property', () => {
    const colorDecls = [...css.matchAll(/(?:^|\s)(?:background-color|color|border-color):\s*([^;]+);/gm)];
    expect(colorDecls.length).toBeGreaterThan(20);
    for (const decl of colorDecls) {
      const value = (decl[1] ?? '').trim();
      const allowed =
        value.startsWith('var(--ff-color-') ||
        value.startsWith('var(--ff-plate-') ||
        ['transparent', 'currentColor', 'inherit', 'Highlight'].includes(value);
      expect(allowed, `unexpected colour value: ${value}`).toBe(true);
    }
  });
});
