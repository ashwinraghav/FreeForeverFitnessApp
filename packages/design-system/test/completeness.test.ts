import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The definition of done, as a test.
 *
 * "Tests and a Storybook entry ship with a component, not in a follow-up" (CLAUDE.md).
 * That is a rule about process, which means it is the first rule to be skipped under
 * time pressure - so it is checked mechanically instead.
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
const primitivesDir = join(here, '..', 'src', 'primitives');
const files = readdirSync(primitivesDir);

const primitives = files
  .filter((file) => file.endsWith('.tsx') && !file.includes('.test.') && !file.includes('.stories.'))
  .map((file) => file.replace(/\.tsx$/, ''))
  .sort();

const index = readFileSync(join(here, '..', 'src', 'index.ts'), 'utf8');

/** The 22 primitives ADR-0013 calls for. Adding one means updating this list on purpose. */
const EXPECTED = [
  'Avatar',
  'Badge',
  'Button',
  'Checkbox',
  'Chip',
  'Dialog',
  'Divider',
  'EmptyState',
  'IconButton',
  'List',
  'Meter',
  'NumberField',
  'ProgressBar',
  'Radio',
  'SegmentedControl',
  'Select',
  'Sheet',
  'Skeleton',
  'Tabs',
  'TextField',
  'Toast',
  'Toggle',
];

describe('the primitive set', () => {
  it('is exactly the 22 primitives that were commissioned', () => {
    expect(primitives).toEqual(EXPECTED);
    expect(primitives).toHaveLength(22);
  });

  it.each(EXPECTED)('%s has a test', (name) => {
    expect(files).toContain(`${name}.test.tsx`);
  });

  it.each(EXPECTED)('%s has a story', (name) => {
    expect(files).toContain(`${name}.stories.tsx`);
  });

  it.each(EXPECTED)('%s is exported from the package index', (name) => {
    expect(index).toContain(`./primitives/${name}.js`);
  });

  it.each(EXPECTED)('%s story covers both themes', (name) => {
    const story = readFileSync(join(primitivesDir, `${name}.stories.tsx`), 'utf8');
    // Either through the shared both-themes helper, or - for the overlay primitives,
    // which cannot be rendered twice side by side - through the theme toolbar.
    const usesPair = story.includes('ThemePair');
    const isOverlay = ['Sheet', 'Dialog'].includes(name);
    expect(usesPair || isOverlay, `${name} shows only one theme`).toBe(true);
  });
});

describe('no primitive contains a raw literal', () => {
  const sources = primitives.map((name) => ({
    name,
    source: readFileSync(join(primitivesDir, `${name}.tsx`), 'utf8'),
  }));

  it.each(sources)('$name has no hex colour', ({ source }) => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it.each(sources)('$name has no raw px or duration in a style prop', ({ source }) => {
    // Components carry no geometry of their own: they apply class names, and the
    // class names resolve to tokens. The two exceptions below are not design values.
    const styleBlocks = source.match(/style=\{\{[^}]*\}\}/g) ?? [];
    for (const block of styleBlocks) {
      expect(block).not.toMatch(/\d+px/);
      expect(block).not.toMatch(/\d+m?s\b/);
    }
  });
});
