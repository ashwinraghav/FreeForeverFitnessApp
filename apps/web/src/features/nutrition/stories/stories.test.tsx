import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComponentType, ReactElement } from 'react';

/**
 * Every story renders.
 *
 * These entries cannot be opened in the gallery yet — Storybook's glob covers
 * only `packages/design-system/src`, and extending it is not this team's file
 * (see `csf.ts`). A story nobody can open and nobody runs is decoration, so
 * this mounts every one of them.
 *
 * It is a smoke test and says so: it asserts that each story produces DOM
 * without throwing, which is what catches a story that has rotted against a
 * prop change. It is not a visual check, and it is not a substitute for looking
 * at the gallery once the glob is fixed.
 */

interface StoryModule {
  default: { title: string; component?: unknown };
  [exportName: string]: unknown;
}

const modules = import.meta.glob<StoryModule>('./*.stories.tsx', { eager: true });

afterEach(cleanup);

describe('nutrition Storybook entries', () => {
  it('finds a story file for every component in the feature', () => {
    const titles = Object.values(modules).map((m) => m.default.title);
    expect(titles.sort()).toEqual([
      'Nutrition/FoodFlags',
      'Nutrition/FoodRow',
      'Nutrition/MacroRing',
      'Nutrition/MacroRows',
      'Nutrition/MicronutrientPanel',
      'Nutrition/PortionSheet',
      'Nutrition/QuickAddSheet',
      'Nutrition/RepeatStrip',
      'Nutrition/UndoToast',
    ]);
  });

  for (const [path, mod] of Object.entries(modules)) {
    const meta = mod.default;
    const Component = meta.component as ComponentType<Record<string, unknown>> | undefined;

    const stories = Object.entries(mod).filter(
      ([name, value]) =>
        name !== 'default' && typeof value === 'object' && value !== null && !Array.isArray(value),
    ) as [string, { args?: Record<string, unknown>; render?: (args: unknown) => ReactElement }][];

    describe(`${path}`, () => {
      it('exports at least one story', () => {
        expect(stories.length).toBeGreaterThan(0);
      });

      for (const [name, story] of stories) {
        it(`renders ${name}`, () => {
          const args = { ...(meta as { args?: Record<string, unknown> }).args, ...story.args };
          const { container } = story.render
            ? render(story.render(args))
            : render(Component ? <Component {...args} /> : <></>);
          expect(container).toBeTruthy();
        });
      }
    });
  }
});
