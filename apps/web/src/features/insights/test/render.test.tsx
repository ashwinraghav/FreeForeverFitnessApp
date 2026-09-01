// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LocalDate } from '@freeforever/data';
import { InsightsProvider, staticInsightsSource } from '../data/context';
import { snapshotFixture } from '../data/fixtures';
import type { ProgressPhotoRef, ProgressPhotoStore } from '../data/ports';
import { BodyView } from '../views/BodyView';
import { ExercisesView } from '../views/ExercisesView';
import { MusclesView } from '../views/MusclesView';
import { OverviewView } from '../views/OverviewView';
import InsightsRoutes from '../InsightsRoutes';
import { RecordingCtx } from './recordingCtx';

/**
 * Render coverage, such as jsdom allows.
 *
 * What this proves: the views mount against a realistic snapshot, every chart card
 * offers its table twin, the adherence grid emits no state that reproaches anyone,
 * and the photo gallery renders metadata with no pixels. What it cannot prove is
 * anything about pixels or resolved colour — jsdom has no 2D canvas context, applies
 * no stylesheet we have not hand-loaded, and computes no `color-mix`. The colour
 * assertions live in `palette.test.ts`, where they are arithmetic rather than
 * screenshots.
 */

const TODAY = '2026-08-28' as LocalDate;
const CHART_WIDTH = 360;
const contexts = new WeakMap<HTMLCanvasElement, RecordingCtx>();

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // jsdom ships no ResizeObserver, and the canvas host measures itself with one.
  // Reporting a real width is what lets the charts actually paint below.
  class StubResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.callback(
        [{ contentRect: { width: CHART_WIDTH, height: 200 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
      void target;
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  // …and no 2D context, so the draw programs get the same recording stand-in the
  // geometry tests use. Without it every chart bails out and the cursor layer,
  // which only exists once a draw program has reported its points, never appears.
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    writable: true,
    value(this: HTMLCanvasElement) {
      const existing = contexts.get(this);
      if (existing !== undefined) return existing;
      const ctx = new RecordingCtx();
      contexts.set(this, ctx);
      return ctx;
    },
  });
  // On HTMLElement, not HTMLCanvasElement: the host div measures itself too, and a
  // zero width there is what makes a chart skip painting.
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    writable: true,
    value: () => ({ left: 0, top: 0, right: CHART_WIDTH, bottom: 200, width: CHART_WIDTH, height: 200 }),
  });
  Object.defineProperty(window, 'ResizeObserver', { writable: true, value: StubResizeObserver });
  // jsdom ships no matchMedia either; the hooks guard against its absence, so this
  // stub exists to exercise the listener path rather than to keep the render alive.
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

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount(node: React.ReactNode, photos?: ProgressPhotoStore): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <InsightsProvider
          source={staticInsightsSource(snapshotFixture(TODAY))}
          {...(photos === undefined ? {} : { photos })}
        >
          {node}
        </InsightsProvider>
      </MemoryRouter>,
    );
  });
}

const buttons = (): HTMLButtonElement[] => [...host.querySelectorAll('button')];
const byText = (text: string): HTMLButtonElement | undefined =>
  buttons().find((button) => button.textContent === text);

describe('every chart card carries its table twin', () => {
  for (const [name, View] of [
    ['overview', OverviewView],
    ['muscles', MusclesView],
    ['exercises', ExercisesView],
    ['body', BodyView],
  ] as const) {
    it(`${name} offers a table for every chart`, async () => {
      await mount(<View />);
      const cards = [...host.querySelectorAll('.ff-in-card')];
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        const empty = card.querySelector('.ff-empty') !== null;
        const toggle = [...card.querySelectorAll('button')].some(
          (button) => button.textContent === 'Show table',
        );
        // A card either has data and a table, or says it has none. Never a chart alone.
        expect(empty || toggle).toBe(true);
      }
    });
  }

  it('swaps the chart for a real table and back', async () => {
    await mount(<OverviewView />);
    const toggle = byText('Show table');
    expect(toggle).toBeDefined();
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');

    await act(async () => toggle?.click());
    const table = host.querySelector('table');
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    expect(table?.querySelector('caption')?.textContent).toMatch(/weekly training volume/i);
    expect(byText('Show chart')).toBeDefined();
  });
});

describe('adherence never reproaches', () => {
  it('emits no missed, danger or warning state', async () => {
    await mount(<OverviewView />);
    const days = [...host.querySelectorAll('.ff-in-day')];
    expect(days.length).toBeGreaterThan(0);
    for (const day of days) {
      expect(day.className).not.toMatch(/missed|danger|warn|fail|broken/i);
    }
    expect(host.innerHTML).not.toMatch(/don'?t break|keep it up|streak at risk|you missed/i);
  });

  it('names each day for a screen reader without judging it', async () => {
    await mount(<OverviewView />);
    const labels = [...host.querySelectorAll('.ff-in-day')].map((day) => day.getAttribute('aria-label') ?? '');
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(labels.some((label) => label.endsWith('no session'))).toBe(true);
    expect(labels.some((label) => label.endsWith('trained'))).toBe(true);
  });
});

describe('records', () => {
  it('lists records with a glyph and a label, and no celebration', async () => {
    await mount(<OverviewView />);
    const rows = [...host.querySelectorAll('.ff-in-pr')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.querySelector('.ff-in-pr__glyph svg')).not.toBeNull();
      expect(row.querySelector('.ff-in-pr__meta')?.textContent).toMatch(/Best estimated 1RM/);
    }
    expect(host.innerHTML).not.toMatch(/confetti|congratulations|🎉|amazing|crushed/i);
  });
});

describe('muscle map', () => {
  it('is one image with a spoken summary, and a keyboard-reachable table beside it', async () => {
    await mount(<MusclesView />);
    const svg = host.querySelector('.ff-in-map__svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toMatch(/This week:/);
    // Every painted region is also outlined, so the anatomy survives greyscale.
    expect(host.querySelectorAll('.ff-in-region').length).toBeGreaterThan(10);
    // The scale is labelled in words, not only in colour.
    expect(host.querySelector('.ff-in-legend')?.textContent).toMatch(/None/);
  });

  it('folds the tail of the distribution instead of drawing every muscle', async () => {
    await mount(<MusclesView />);
    const bars = [...host.querySelectorAll('.ff-in-bar__label')].map((node) => node.textContent ?? '');
    expect(bars.length).toBeLessThanOrEqual(9);
    expect(bars.some((label) => label.startsWith('Other'))).toBe(true);
  });
});

describe('progress photos', () => {
  const photo: ProgressPhotoRef = {
    id: 'p1',
    localDate: '2026-08-01' as LocalDate,
    pose: 'front_relaxed',
    widthPx: 900,
    heightPx: 1200,
    bytesLocation: 'absent',
  };

  it('renders metadata when the bytes are not reachable, and never a broken image', async () => {
    const store: ProgressPhotoStore = {
      list: () => [photo],
      openLocal: async () => null,
      subscribe: () => () => undefined,
    };
    await mount(<BodyView />, store);
    // Selectors moved when the grid became a reel; the guarantee did not. A
    // photo whose bytes are not on this device is a normal state (ADR-0024) and
    // must render as a label, never as a broken image.
    expect(host.querySelector('.ff-in-reel__pending')?.textContent).toBe('Not on this device');
    expect(host.querySelector('.ff-in-reel__stage img')).toBeNull();
  });

  it('says photos stay on the device when there are none', async () => {
    await mount(<BodyView />);
    expect(host.textContent).toMatch(/stay on this device/i);
  });
});

describe('missing aggregates', () => {
  it('renders empty states rather than failing when nothing is materialised', async () => {
    const blank = {
      ...snapshotFixture(TODAY),
      trainingVolume: null,
      exerciseProgress: null,
      personalRecords: null,
      adherence: null,
      bodyMetrics: null,
    };
    await act(async () => {
      root.render(
        <MemoryRouter>
          <InsightsProvider source={staticInsightsSource(blank)}>
            <OverviewView />
          </InsightsProvider>
        </MemoryRouter>,
      );
    });
    expect(host.querySelectorAll('.ff-empty').length).toBeGreaterThan(0);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <InsightsProvider source={staticInsightsSource(blank)}>
            <BodyView />
          </InsightsProvider>
        </MemoryRouter>,
      );
    });
    // The body screens say what to do next, in the reader's terms.
    expect(host.textContent).toMatch(/Log a weigh-in/i);
  });
});

describe('the entry point', () => {
  // Navigation between tabs is covered end-to-end in `navigation.test.tsx`, which
  // mounts this behind the shell's splat route and clicks every ordered pair.
  it('mounts with no data source at all', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/insights']}>
          <InsightsRoutes />
        </MemoryRouter>,
      );
    });
    expect(host.querySelector('.ff-insights')).not.toBeNull();
    expect(host.querySelectorAll('nav a').length).toBe(4);
  });

  it('sets the heat ramp custom properties on its own root', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <InsightsRoutes />
        </MemoryRouter>,
      );
    });
    const style = host.querySelector<HTMLElement>('.ff-insights')?.getAttribute('style') ?? '';
    expect(style).toContain('--ff-in-heat-4');
    expect(style).toContain('color-mix(in oklab');
  });
});

describe('the chart cursor', () => {
  it('is keyboard operable and speaks each point', async () => {
    await mount(<OverviewView />);
    const plot = host.querySelector<HTMLElement>('.ff-in-canvas');
    expect(plot?.getAttribute('tabindex')).toBe('0');
    expect(plot?.getAttribute('aria-label')).toMatch(/arrow keys/i);

    const readout = host.querySelector('.ff-in-readout');
    expect(readout?.getAttribute('aria-live')).toBe('polite');
    // Nothing selected yet: an invitation, not a value pretending to be one.
    expect(readout?.textContent).toMatch(/arrow key/i);

    await act(async () => {
      plot?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    const atEnd = host.querySelector('.ff-in-readout')?.textContent ?? '';
    expect(atEnd).toMatch(/^Week of .+: .+, \d+ sets over \d+ sessions?$/);

    await act(async () => {
      plot?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(host.querySelector('.ff-in-readout')?.textContent).not.toBe(atEnd);

    // Escape clears the selection rather than leaving a rule stranded on the plot.
    await act(async () => {
      plot?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(host.querySelector('.ff-in-cursor')).toBeNull();
  });

  it('places the rule inside the plot, not over the axis labels', async () => {
    await mount(<OverviewView />);
    const plot = host.querySelector<HTMLElement>('.ff-in-canvas');
    await act(async () => {
      plot?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    const rule = host.querySelector<HTMLElement>('.ff-in-cursor');
    expect(rule).not.toBeNull();
    const start = Number.parseFloat(rule?.style.insetInlineStart ?? '0');
    const top = Number.parseFloat(rule?.style.insetBlockStart ?? '0');
    const size = Number.parseFloat(rule?.style.blockSize ?? '0');
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThanOrEqual(100);
    expect(top + size).toBeLessThanOrEqual(100);
    expect(size).toBeGreaterThan(0);
  });

  it('reports the record on a lift that set one', async () => {
    await mount(<ExercisesView />);
    const plot = host.querySelector<HTMLElement>('.ff-in-canvas');
    await act(async () => {
      plot?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(host.querySelector('.ff-in-readout')?.textContent).toMatch(/estimated, top set/);
  });

  it('draws every chart through the same programs', async () => {
    await mount(<OverviewView />);
    const canvas = host.querySelector('canvas');
    const recorded = canvas === null ? undefined : contexts.get(canvas);
    expect(recorded?.ops('roundRect').length).toBeGreaterThan(0);
  });
});

describe('one number per glance', () => {
  /*
   * A structural guard, and honest about its limits: jsdom has no layout engine, so
   * nothing here proves anything fits. The 412px measurements live in the Pixel 8a
   * harness and are recorded in the review notes.
   *
   * What this *can* hold is the rule that made the layout fail in the first place —
   * four equal display-size figures across a phone. These assertions fail if a view
   * grows a second hero or brings the tile grid back, which is the shape of the
   * regression rather than one instance of it.
   */
  for (const [name, View] of [
    ['overview', OverviewView],
    ['muscles', MusclesView],
    ['exercises', ExercisesView],
    ['body', BodyView],
  ] as const) {
    it(`${name} leads with at most one headline figure`, async () => {
      await mount(<View />);
      expect(host.querySelectorAll('.ff-in-hero').length).toBeLessThanOrEqual(1);
      // The grid of equal tiles is gone and does not come back.
      expect(host.querySelector('.ff-in-tiles')).toBeNull();
      expect(host.querySelector('.ff-in-tile')).toBeNull();
    });
  }

  it('keeps the unit as its own element so it cannot break onto another line', async () => {
    await mount(<OverviewView />);
    const value = host.querySelector('.ff-in-hero__value');
    const unit = value?.querySelector('.ff-in-hero__unit');
    expect(unit).not.toBeNull();
    // The number is a bare text node beside the unit span, not concatenated into it:
    // that split is what lets the unit be set a size down and stay glued to the number.
    expect(value?.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(value?.firstChild?.textContent).not.toMatch(/kg|lb/);
    expect(unit?.textContent?.trim()).toBe('kg');
  });

  it('states the supporting numbers as a definition list, not as more figures', async () => {
    await mount(<OverviewView />);
    const list = host.querySelector('.ff-in-facts');
    expect(list?.tagName).toBe('DL');
    const terms = list?.querySelectorAll('dt') ?? [];
    const values = list?.querySelectorAll('dd') ?? [];
    expect(terms.length).toBe(values.length);
    expect(terms.length).toBeGreaterThan(0);
    // Every value is announced with the thing it measures, never as a loose number.
    for (const term of terms) expect(term.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it('does not restate the selected window three times over', async () => {
    await mount(<OverviewView />);
    const label = host.querySelector('.ff-in-hero__label')?.textContent ?? '';
    // The range control above and the chart subtitle below both name the window.
    expect(label).not.toMatch(/\d+ weeks/);
  });
});
