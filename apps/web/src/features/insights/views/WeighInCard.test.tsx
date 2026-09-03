import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LocalDate } from '@freeforever/data';

import { createBodyStore } from '../../../data/bodyStore';
import { WeighInCard } from './WeighInCard';

vi.mock('../../../data/insightsSource', () => ({ notifyLocalDataChanged: vi.fn() }));

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  } as Storage;
}

const TODAY = '2026-09-03' as LocalDate;
let store: ReturnType<typeof createBodyStore>;

beforeEach(() => {
  store = createBodyStore(memoryStorage());
});

const mount = (over: Partial<Parameters<typeof WeighInCard>[0]> = {}) =>
  render(
    <WeighInCard today={TODAY} massUnit="kg" todayKg={null} store={store} {...over} />,
  );

describe('logging a weigh-in', () => {
  /*
   * Reported: "where do I log a weight in the app". Nowhere. The Body tab's own empty
   * state has always read "log a weigh-in and the trend starts here", promising a
   * control that existed in no screen.
   */
  it('saves what was entered', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: /increase bodyweight/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(store.list()).toEqual([{ localDate: TODAY, weightKg: 0.1 }]);
  });

  it('will not save nothing', async () => {
    // `null` is not zero. Saving an untouched field would file a 0kg weigh-in and put a
    // fictional point on the trend.
    mount();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(store.list()).toEqual([]);
  });

  it('opens on today’s value so a second save is a correction', () => {
    mount({ todayKg: 81.4 });
    // A string, because NumberField is `type="text"` with a decimal inputMode — a
    // deliberate choice in that primitive, not an accident here.
    expect(screen.getByLabelText('Bodyweight')).toHaveValue('81.4');
    expect(screen.getByRole('status')).toHaveTextContent(/logged 81.4 kg today/i);
  });

  it('stores kilograms even when pounds are on screen', async () => {
    /*
     * The store is always kg. One that held whichever unit was selected would silently
     * reinterpret every existing row the day somebody switched — a chart that changes
     * shape because of a display setting.
     */
    mount({ massUnit: 'lb', todayKg: null });
    const field = screen.getByLabelText('Bodyweight');
    await userEvent.clear(field);
    await userEvent.type(field, '180');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const stored = store.list()[0]?.weightKg ?? 0;
    expect(stored).toBeCloseTo(81.65, 1);
    // And emphatically not the number as typed.
    expect(stored).not.toBeCloseTo(180, 0);
  });

  it('shows the value back in the unit on screen, not in kilograms', () => {
    mount({ massUnit: 'lb', todayKg: 81.65 });
    expect(screen.getByRole('status')).toHaveTextContent(/180(\.0)? lb/);
  });

  it('offers steppers rather than demanding the keyboard', () => {
    // The keyboard costs ~400px on a screen read one-handed, and the steppers hold to
    // repeat, so 74 to 96 is a held thumb. Same reasoning as the set editor.
    mount();
    expect(screen.getByRole('button', { name: /increase bodyweight/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /decrease bodyweight/i })).toBeInTheDocument();
    expect(document.activeElement?.tagName).not.toBe('INPUT');
  });

  it('tells the chart to repaint, because a same-tab write fires no storage event', async () => {
    const { notifyLocalDataChanged } = await import('../../../data/insightsSource');
    mount();
    await userEvent.click(screen.getByRole('button', { name: /increase bodyweight/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(notifyLocalDataChanged).toHaveBeenCalled();
  });
});
