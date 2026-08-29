import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES } from '../../app/routes';
import InsightsScreen from '../InsightsScreen';
import { WORKOUT_HISTORY_KEY, notifyLocalDataChanged } from '../insightsSource';
import { RecordingCtx } from '../../features/insights/test/recordingCtx';
import { SESSION_1, SESSIONS, historyBlob } from './fixtures';

/**
 * The Progress tab, mounted exactly the way `App.tsx` mounts it, over a device that
 * has actually trained.
 *
 * This is the test the missing `source` prop would have failed. It asserts the
 * numbers on the screen — three sessions, a three-day streak, thirteen records — and
 * a screen wired to nothing renders every one of them as a dash or a zero. "It
 * mounts" was already true before any of this work and proved nothing.
 *
 * jsdom draws no canvas, so nothing here claims anything about the charts. What it
 * can see is the stat row, which is DOM text, and the table twin behind every chart,
 * which is a real `<table>`.
 */

let host: HTMLDivElement;
let root: Root;

/**
 * jsdom ships neither `ResizeObserver` nor a 2D canvas context, and the chart hosts
 * want both on mount. The same stand-ins the insights team's own render test uses —
 * they keep the tree alive so the text around the charts can be read. Nothing below
 * asserts a pixel.
 */
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: StubResizeObserver,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    writable: true,
    value: () => new RecordingCtx(),
  });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-13T09:00:00Z'));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  window.localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.localStorage.clear();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[ROUTES.insights]}>
        <Routes>
          <Route path={`${ROUTES.insights}/*`} element={<InsightsScreen />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

/** The value beside a label in the `<dl>` of facts under the hero figure. */
function fact(label: string): string {
  for (const item of host.querySelectorAll('.ff-in-fact')) {
    if (item.querySelector('dt')?.textContent === label) {
      return item.querySelector('dd')?.textContent ?? '';
    }
  }
  throw new Error(`no fact labelled ${label}`);
}

function buttonWith(text: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === text,
  );
  if (match === undefined) throw new Error(`no button reading ${text}`);
  return match;
}

describe('a device with sessions on it', () => {
  beforeEach(() => {
    window.localStorage.setItem(WORKOUT_HISTORY_KEY, historyBlob(SESSIONS));
  });

  it('shows what was actually trained, not an empty state', async () => {
    await mount();
    expect(fact('Sessions')).toBe('3');
    expect(fact('Streak')).toBe('3 days');
    expect(fact('Records (90d)')).toBe('13');
    // 3350 kg over the 12-week window is 279 kg a week, compacted.
    expect(host.querySelector('.ff-in-hero__value')?.textContent).toBe('279 kg');
  });

  it('puts the weekly numbers in the table behind the volume chart', async () => {
    await mount();
    await act(async () => buttonWith('Show table').click());
    const cells = [...host.querySelectorAll('table tbody tr')].map((row) =>
      [...row.querySelectorAll('td, th')].map((cell) => cell.textContent),
    );
    // The week of Monday 10 August: 3,350 kg over 7 sets in 3 sessions, 2.3 hours.
    expect(cells).toContainEqual(['10 Aug', '3,350 kg', '7', '3', '2.3 h']);
  });

  it('names the lift each record belongs to', async () => {
    await mount();
    const text = host.textContent ?? '';
    expect(text).toContain('Barbell bench press');
    expect(text).toContain('Back squat');
    // The counts subtitle on the records card.
    expect(text).toContain('13 in total, across 2 exercises');
  });

  it('is still empty when nothing has been logged', async () => {
    window.localStorage.clear();
    await mount();
    expect(fact('Sessions')).toBe('0');
    expect(fact('Streak')).toBe('0 days');
    expect(host.textContent).toContain('Log a session and this fills in');
  });
});

describe('a session finished while the tab is open', () => {
  it('redraws without a reload', async () => {
    window.localStorage.setItem(WORKOUT_HISTORY_KEY, historyBlob([SESSION_1]));
    await mount();
    expect(fact('Sessions')).toBe('1');
    expect(fact('Streak')).toBe('1 day');

    await act(async () => {
      window.localStorage.setItem(WORKOUT_HISTORY_KEY, historyBlob(SESSIONS));
      notifyLocalDataChanged();
    });

    expect(fact('Sessions')).toBe('3');
    expect(fact('Streak')).toBe('3 days');
  });
});
