// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LocalDate } from '@freeforever/data';
import { ROUTES } from '../../../app/routes';
import { snapshotFixture } from '../data/fixtures';
import { staticInsightsSource } from '../data/context';
import InsightsRoutes from '../InsightsRoutes';

/**
 * Tab navigation, clicked through rather than rendered in isolation.
 *
 * The bug this exists to prevent only appeared on the *second* navigation: relative
 * `to` paths resolve against the current location, so the first click worked, the
 * second nested the URL, matched nothing, and blanked the page. Every view rendered
 * perfectly on its own and by direct URL, so a per-view render test passed the whole
 * time. The only assertion that catches it is one that walks between tabs.
 *
 * So this walks **every ordered pair** — from each tab, to each other tab — and
 * checks the URL, the content and the active pill after each hop.
 *
 * It also mounts the feature the way the shell does, behind the splat route in
 * `app/routes.ts`. Mounting `<InsightsRoutes />` bare under a router changes how
 * relative paths resolve, which is the second reason the original test was blind:
 * it was not reproducing the real mount.
 */

const TODAY = '2026-08-28' as LocalDate;

interface Tab {
  readonly label: string;
  readonly path: string;
  /** A card title only this view renders. */
  readonly marker: string;
}

const TABS: readonly Tab[] = [
  { label: 'Overview', path: ROUTES.insights, marker: 'Training volume' },
  { label: 'Muscles', path: `${ROUTES.insights}/muscles`, marker: 'Distribution' },
  { label: 'Lifts', path: `${ROUTES.insights}/exercises`, marker: 'Records for this lift' },
  { label: 'Body', path: `${ROUTES.insights}/body`, marker: 'Progress photos' },
];

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(window, 'ResizeObserver', { writable: true, value: StubResizeObserver });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/** Renders the live pathname so a navigation can be asserted, not inferred. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="path">{location.pathname}</span>;
}

/**
 * Mounted exactly as `app/App.tsx` mounts it: behind the splat route.
 *
 * A fresh root each time, because `MemoryRouter` only reads `initialEntries` on its
 * first mount — re-rendering it into a live root leaves the history where the last
 * click put it, which would quietly make each pair start from the wrong tab.
 */
async function mountShell(at: string): Promise<void> {
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[at]}>
        <LocationProbe />
        <Routes>
          <Route
            path={`${ROUTES.insights}/*`}
            element={<InsightsRoutes source={staticInsightsSource(snapshotFixture(TODAY))} />}
          />
        </Routes>
      </MemoryRouter>,
    );
  });
}

const pathname = (): string => host.querySelector('[data-testid="path"]')?.textContent ?? '';

const tabLink = (label: string): HTMLAnchorElement | undefined =>
  [...host.querySelectorAll('nav a')].find(
    (link): link is HTMLAnchorElement => link.textContent === label,
  );

async function clickTab(label: string): Promise<void> {
  const link = tabLink(label);
  expect(link, `tab "${label}" is missing`).toBeDefined();
  await act(async () => {
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  });
}

const cardTitles = (): string[] =>
  [...host.querySelectorAll('.ff-in-cardtitle')].map((node) => node.textContent ?? '');

const activeTabs = (): string[] =>
  [...host.querySelectorAll('nav a[aria-current="page"]')].map((node) => node.textContent ?? '');

function expectShowing(tab: Tab): void {
  expect(pathname(), `wrong URL after navigating to ${tab.label}`).toBe(tab.path);
  expect(cardTitles(), `${tab.label} did not render`).toContain(tab.marker);
  // Exactly one pill is lit, and it is the right one. Two lit, or Overview lit on
  // every tab, is the `to="."` failure and is just as broken as a blank page.
  expect(activeTabs()).toEqual([tab.label]);
}

describe('tab navigation', () => {
  for (const tab of TABS) {
    it(`renders ${tab.label} on a direct load`, async () => {
      await mountShell(tab.path);
      expectShowing(tab);
    });
  }

  for (const from of TABS) {
    it(`reaches every other tab from ${from.label}`, async () => {
      for (const to of TABS) {
        await mountShell(from.path);
        expectShowing(from);
        await clickTab(to.label);
        expectShowing(to);
      }
    });
  }

  it('survives a long walk without the URL nesting', async () => {
    // The original failure needed three hops to show itself: the first click worked,
    // the second nested the path, the third landed on nothing.
    await mountShell(ROUTES.insights);
    for (const label of ['Muscles', 'Lifts', 'Body', 'Overview', 'Lifts', 'Muscles', 'Body']) {
      await clickTab(label);
      const expected = TABS.find((tab) => tab.label === label);
      expect(expected).toBeDefined();
      if (expected !== undefined) expectShowing(expected);
    }
  });

  it('sends an unknown sub-path back to the overview, not to itself', async () => {
    await mountShell(`${ROUTES.insights}/muscles/exercises`);
    // This is the exact URL the old relative links produced. It must land somewhere
    // real rather than redirect to itself and render nothing.
    expect(pathname()).toBe(ROUTES.insights);
    expect(cardTitles()).toContain('Training volume');
  });
});

describe('empty-state copy', () => {
  it('speaks to the reader, not about our architecture', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`${ROUTES.insights}/body`]}>
          <Routes>
            {/* No source at all — the state every user sees until sync wires one up. */}
            <Route path={`${ROUTES.insights}/*`} element={<InsightsRoutes />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    const copy = [...host.querySelectorAll('.ff-empty__body')].map((node) => node.textContent ?? '');
    expect(copy.length).toBeGreaterThan(0);
    for (const line of copy) {
      expect(line, `developer language in user-facing copy: "${line}"`).not.toMatch(
        /materiali[sz]|aggregate|firestore|reducer|cache|snapshot|queries the server|sync layer/i,
      );
    }
    expect(copy.join(' ')).toMatch(/Log a weigh-in/);
  });
});
