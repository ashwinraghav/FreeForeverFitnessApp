/// <reference types="vite/client" />
import { cleanup, render } from '@testing-library/react';
import { composeStories, setProjectAnnotations } from '@storybook/react';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The shared preview, i.e. exactly what a root-level Storybook would load.
import previewAnnotations from '../src/storybook/preview.js';

/**
 * Every story mounts, in both themes, without throwing and without a React warning.
 *
 * Borrowed from the nutrition team, whose reasoning is right: a story nobody can open
 * and nobody runs is decoration. Their version hand-rolls a CSF interpreter because
 * `apps/web` has no Storybook dependency; this package does, so it uses the real
 * `composeStories`, which applies the project decorators, args and parameters exactly
 * as the gallery would. That difference matters - it means this also exercises the
 * theme decorator and the token stylesheet wiring, not just the component.
 *
 * It is a smoke test and says so: it proves a story produces DOM and stays quiet. It
 * is not a visual check and does not replace looking at the gallery.
 */

setProjectAnnotations(previewAnnotations);

beforeAll(() => {
  // jsdom implements neither the top layer nor matchMedia; the Dialog story and the
  // reduced-motion decorator would otherwise throw before rendering anything.
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
    };
  }
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
});

/**
 * A React warning is a failure here, not noise. "Each child in a list should have a
 * unique key", "validateDOMNesting", a controlled/uncontrolled flip - all of them are
 * real defects that a story is uniquely good at surfacing, and all of them are
 * invisible if nobody reads the console.
 */
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const expectQuiet = () => {
  const calls = [...consoleError.mock.calls, ...consoleWarn.mock.calls];
  expect(calls.map((args) => String(args[0]))).toEqual([]);
};

type StoryModule = Record<string, unknown> & {
  default: { title: string };
};

const modules = import.meta.glob<StoryModule>('../src/primitives/*.stories.tsx', {
  eager: true,
});

const THEMES = ['dark', 'light'] as const;

describe('Storybook entries', () => {
  it('finds a story file for every primitive', () => {
    // Guards the glob itself. If this file ever stops matching - a rename, a moved
    // directory - the suite would otherwise pass by testing nothing at all.
    expect(Object.keys(modules)).toHaveLength(22);
  });

  it('gives every story a Primitives/* title, so the gallery groups them', () => {
    for (const mod of Object.values(modules)) {
      expect(mod.default.title).toMatch(/^Primitives\//);
    }
  });

  for (const [path, mod] of Object.entries(modules)) {
    const composed = composeStories(mod as Parameters<typeof composeStories>[0]);
    const entries = Object.entries(composed);
    const name = path.split('/').pop() ?? path;

    describe(name, () => {
      it('exports at least one story', () => {
        expect(entries.length).toBeGreaterThan(0);
      });

      for (const [storyName, Story] of entries) {
        for (const theme of THEMES) {
          it(`renders ${storyName} in ${theme}`, () => {
            const { container } = render(
              <div data-theme={theme}>{(Story as () => ReactElement)()}</div>,
            );
            expect(container.firstChild).not.toBeNull();
            expect(container.textContent ?? '').toBeDefined();
            expectQuiet();
          });
        }
      }
    });
  }
});
