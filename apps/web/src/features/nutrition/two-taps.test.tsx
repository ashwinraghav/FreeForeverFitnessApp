import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Serving } from '@freeforever/core/src/nutrition/index.js';
import NutritionRoutes from './NutritionRoutes.js';
import { logFood } from './data/log.js';
import { STORAGE_KEY } from './data/store.js';
import { today } from './data/dates.js';
import { EMPTY_STATE, type FoodSnapshot } from './data/types.js';

/**
 * The two-taps bar, exercised rather than argued.
 *
 * This is the headline product commitment in the nutrition feature: logging a
 * food you have eaten before must not cost the six taps MyFitnessPal charges,
 * because the tap count on the ninetieth repetition is the single biggest
 * reason people abandon food logging.
 *
 * Reading that guarantee off a component tree is an argument. What follows is a
 * demonstration: the real entry point is rendered against a real (seeded)
 * store, a real pointer interaction is dispatched, and the assertion is that
 * the entry reached persisted state — with the number of clicks that reached
 * the document counted independently, so the claim cannot drift as the screen
 * changes.
 */

const SLICE: Serving = { name: 'slice', gramsPerServing: 28 };

const CHICKEN: FoodSnapshot = {
  key: 'core:171077',
  ref: { source: 'bundled', foodId: 'core:171077', name: 'Chicken breast, raw' },
  nutrientsPer100g: { energyKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 },
  servings: [SLICE, { name: 'g', gramsPerServing: 1 }],
};

const OATS: FoodSnapshot = {
  key: 'core:169705',
  ref: { source: 'bundled', foodId: 'core:169705', name: 'Oats, rolled' },
  nutrientsPer100g: { energyKcal: 389, proteinG: 16.9, carbsG: 66.3, fatG: 6.9 },
  servings: [{ name: 'g', gramsPerServing: 1 }],
};

/**
 * A user who logged chicken for lunch yesterday, exactly as the app would have
 * left it — built through the real reducer, not hand-written, so the fixture
 * cannot drift from what the app actually writes.
 */
function seedStorageWithHistory(): void {
  let state = EMPTY_STATE;
  state = logFood(state, {
    date: '2026-08-27',
    tzOffsetMinutes: 60,
    slot: 'lunch',
    snapshot: CHICKEN,
    quantity: 6,
    serving: SLICE,
    entryId: 'yesterday-1',
    now: Date.parse('2026-08-27T12:30:00Z'),
  });
  state = logFood(state, {
    date: '2026-08-27',
    tzOffsetMinutes: 60,
    slot: 'breakfast',
    snapshot: OATS,
    quantity: 80,
    serving: { name: 'g', gramsPerServing: 1 },
    entryId: 'yesterday-2',
    now: Date.parse('2026-08-27T07:00:00Z'),
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function readState(): typeof EMPTY_STATE {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
}

/** Counts every click that reaches the document, so the tap count is measured. */
function countClicks(): () => number {
  let clicks = 0;
  const listener = () => {
    clicks += 1;
  };
  document.addEventListener('click', listener, true);
  return () => {
    document.removeEventListener('click', listener, true);
    return clicks;
  };
}

function renderNutrition() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <NutritionRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('logging a repeat food', () => {
  it('takes ONE tap from the nutrition screen, and the entry is persisted', async () => {
    seedStorageWithHistory();
    const user = userEvent.setup();
    const stopCounting = countClicks();
    renderNutrition();

    // The shortcut is on screen the moment the tab opens — no "+", no menu, no
    // disclosure step. If any of those creep in, the click count below fails.
    const strip = screen.getByRole('list', { name: /log again/i });
    const shortcut = within(strip).getByRole('listitem', { name: /log chicken breast, raw/i });

    await user.click(shortcut);

    expect(stopCounting()).toBe(1);

    const state = readState();
    const day = state.days[today()];
    expect(day, 'nothing was logged to today').toBeDefined();
    expect(day?.entryCount).toBe(1);

    const entry = day?.meals[0]?.entries[0];
    expect(entry?.food.name).toBe('Chicken breast, raw');
    // Reproduced with yesterday's portion and yesterday's meal, untouched.
    expect(entry?.quantity).toBe(6);
    expect(entry?.serving.name).toBe('slice');
    expect(entry?.massG).toBe(168);
    expect(day?.meals[0]?.slot).toBe('lunch');
  });

  it('shows the logged energy on the ring after that one tap', async () => {
    seedStorageWithHistory();
    const user = userEvent.setup();
    renderNutrition();

    const strip = screen.getByRole('list', { name: /log again/i });
    await user.click(within(strip).getByRole('listitem', { name: /log oats, rolled/i }));

    // 80 g of oats at 389 kcal/100 g = 311 kcal. Assert on the ring itself
    // rather than on the page text — the same figure legitimately appears on
    // the meal row, and a loose matcher would pass on either.
    const ring = await screen.findByRole('img', { name: /311 kcal logged/i });
    expect(ring).toBeInTheDocument();
  });

  it('offers an undo, which is what makes a one-tap write safe', async () => {
    seedStorageWithHistory();
    const user = userEvent.setup();
    renderNutrition();

    const strip = screen.getByRole('list', { name: /log again/i });
    await user.click(within(strip).getByRole('listitem', { name: /log chicken/i }));
    expect(readState().days[today()]?.entryCount).toBe(1);

    await user.click(screen.getByRole('button', { name: /undo/i }));

    const day = readState().days[today()];
    expect(day?.entryCount).toBe(0);
    expect(day?.totals.energyKcal).toBe(0);
  });

  it('names the whole action on the control, so one tap is not a blind tap', () => {
    seedStorageWithHistory();
    renderNutrition();

    const strip = screen.getByRole('list', { name: /log again/i });
    const shortcut = within(strip).getByRole('listitem', { name: /log chicken breast, raw/i });

    // The visible label is clamped to two lines, so a screen-reader user has to
    // learn the portion, the energy and the destination meal from the name.
    const name = shortcut.getAttribute('aria-label') ?? '';
    expect(name).toMatch(/6 × slice/i);
    expect(name).toMatch(/277 kilocalories/i);
    expect(name).toMatch(/to lunch/i);
  });

  it('puts the most useful shortcut first, not the most recent', async () => {
    // Oats every morning for a fortnight; chicken once, an hour ago.
    let state = EMPTY_STATE;
    const now = Date.now();
    for (let i = 0; i < 14; i++) {
      state = logFood(state, {
        date: '2026-08-27',
        tzOffsetMinutes: 60,
        slot: 'breakfast',
        snapshot: OATS,
        quantity: 80,
        serving: { name: 'g', gramsPerServing: 1 },
        entryId: `oats-${i}`,
        now: now - (14 - i) * 24 * 60 * 60 * 1000,
      });
    }
    state = logFood(state, {
      date: '2026-08-27',
      tzOffsetMinutes: 60,
      slot: 'dinner',
      snapshot: CHICKEN,
      quantity: 6,
      serving: SLICE,
      entryId: 'chicken-1',
      now: now - 60 * 60 * 1000,
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    renderNutrition();
    const items = within(screen.getByRole('list', { name: /log again/i })).getAllByRole('listitem');
    expect(items[0]?.getAttribute('aria-label')).toMatch(/oats/i);
  });

  it('does not show the shortcut strip to someone with no history', () => {
    renderNutrition();
    expect(screen.queryByRole('list', { name: /log again/i })).not.toBeInTheDocument();
    // They get the real first-run path instead, which is scan or search.
    expect(screen.getByRole('button', { name: /scan a barcode/i })).toBeInTheDocument();
  });
});

describe('logging through the search screen', () => {
  it('takes three taps, pinned so the number cannot drift unnoticed', async () => {
    // Honest counterweight to the headline: the two-tap bar is about REPEAT
    // logging via the shortcut strip. Going through search costs open → pick →
    // confirm portion. Pinned exactly rather than bounded, so a regression to
    // four fails here instead of being absorbed by a loose assertion.
    seedStorageWithHistory();
    const user = userEvent.setup();
    const stopCounting = countClicks();
    renderNutrition();

    await user.click(screen.getByRole('button', { name: /^search$/i })); // 1: open search
    const results = await screen.findByRole('list', { name: /recent/i });
    await user.click(within(results).getAllByRole('button')[0] as HTMLElement); // 2: pick a food
    // 3: the portion sheet opens pre-filled; accept it.
    await user.click(await screen.findByRole('button', { name: /log it/i })); // 3

    expect(stopCounting()).toBe(3);
    expect(readState().days[today()]?.entryCount).toBe(1);
  });
});
