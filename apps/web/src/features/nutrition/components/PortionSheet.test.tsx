import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { servingsForFood } from '@freeforever/core/src/nutrition/index.js';
import { PortionSheet } from './PortionSheet.js';
import type { FoodSnapshot } from '../data/types.js';

/**
 * The serving picker, exercised against the user's own test case.
 *
 * > "How easy is it to log one serving of Optimum Nutrition's Gold Standard
 * > Whey vanilla? Each serving is one scoop, 23 g of protein. I should just be
 * > able to select Optimum Nutrition and select one serving, and a subtitle
 * > appears that it's one scoop, roughly 120 calories."
 *
 * Both fixtures are built through `servingsForFood` from the two fields the
 * index carries (`servingGrams`, `servingLabel`), not hand-written, so they
 * cannot drift from what a rebuilt index will hand the app.
 *
 * What this file cannot tell you: whether any of it *looks* right. jsdom has no
 * layout engine, so the sheet's width, the wrap of the subtitle and the size of
 * the picker are invisible here and were checked in a browser at 412px instead
 * (CLAUDE.md, "No test in this repo can catch a layout bug").
 */

/** Optimum Nutrition Gold Standard 100% Whey, vanilla. One scoop is 31 g. */
const WHEY: FoodSnapshot = {
  key: 'off:748927024074',
  ref: {
    source: 'bundled',
    foodId: 'off:748927024074',
    name: 'Gold Standard 100% Whey, Vanilla Ice Cream',
    brand: 'Optimum Nutrition',
  },
  nutrientsPer100g: { energyKcal: 387, proteinG: 77.4, carbsG: 9.7, fatG: 3.2 },
  servings: servingsForFood({
    statedServingGrams: 31,
    statedServingLabel: '1 scoop (31 g)',
    basis: 'g',
  }),
};

/** A USDA row exactly as today's index ships them: nutrients, and no serving. */
const CHICKEN: FoodSnapshot = {
  key: 'core:171077',
  ref: { source: 'bundled', foodId: 'core:171077', name: 'Chicken breast, raw' },
  nutrientsPer100g: { energyKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 },
  servings: servingsForFood({ basis: 'g' }),
};

function open(snapshot: FoodSnapshot, onLog = vi.fn()) {
  render(
    <PortionSheet
      open
      onClose={() => undefined}
      snapshot={snapshot}
      initialSlot="post_workout"
      massUnit="g"
      energyUnit="kcal"
      onLog={onLog}
    />,
  );
  return onLog;
}

afterEach(cleanup);

describe('a food that states its own serving', () => {
  it('opens on one serving, so logging a scoop costs no taps at all', () => {
    open(WHEY);
    expect(screen.getByLabelText('Amount')).toHaveValue('1');
    expect(screen.getByLabelText('Serving')).toHaveDisplayValue('1 serving — 1 scoop (31 g)');
  });

  it('shows what one serving is as text, not as another input', () => {
    open(WHEY);
    const amount = screen.getByLabelText('Amount');
    const described = amount.getAttribute('aria-describedby') ?? '';
    const subtitle = described
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      // The field is described by its unit ("scoop") as well, so pick the
      // description that carries the whole line.
      .find((text) => text.includes('·'));

    expect(subtitle).toBe('1 scoop (31 g) · ~120 kcal · 24 g protein');
    // "not an editable thing, just a subtitle or subtext" — the user's words.
    // Whatever carries it must not be a control.
    const node = screen.getByText('1 scoop (31 g) · ~120 kcal · 24 g protein');
    expect(node.querySelector('input, button, select, textarea, [contenteditable]')).toBeNull();
    expect(node.tagName).not.toBe('INPUT');
  });

  it('offers the packet’s serving and a raw weight, and nothing redundant', () => {
    open(WHEY);
    const options = within(screen.getByLabelText('Serving')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['1 serving — 1 scoop (31 g)', 'Grams']);
  });

  it('logs 31 g when the user taps through without touching anything', async () => {
    const onLog = open(WHEY);
    await userEvent.click(screen.getByRole('button', { name: 'Log it' }));
    expect(onLog).toHaveBeenCalledWith(
      expect.objectContaining({
        quantity: 1,
        serving: expect.objectContaining({ name: 'scoop', gramsPerServing: 31 }),
      }),
    );
  });

  it('re-expresses the amount in grams without changing how much was eaten', async () => {
    open(WHEY);
    await userEvent.selectOptions(screen.getByLabelText('Serving'), 'Grams');
    expect(screen.getByLabelText('Amount')).toHaveValue('31');
    expect(screen.getByText('31 g · ~120 kcal · 24 g protein')).toBeTruthy();
  });
});

describe('a food that states no serving', () => {
  it('opens on 100 g — the old default was 1 g, which is not a portion of anything', () => {
    open(CHICKEN);
    expect(screen.getByLabelText('Amount')).toHaveValue('100');
    expect(screen.getByText('100 g · ~165 kcal · 31 g protein')).toBeTruthy();
  });

  it('offers no "1 serving" row, because it does not know what one serving is', () => {
    open(CHICKEN);
    const options = within(screen.getByLabelText('Serving')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Grams']);
  });

  it('says the serving size is missing rather than letting 100 g imply one', () => {
    open(CHICKEN);
    const picker = screen.getByLabelText('Serving');
    const described = (picker.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toMatch(/No serving size on this food/i);
    // The positive case in the same file, per CLAUDE.md: a food that *does*
    // state a serving must not carry the caveat, or the assertion above would
    // pass against a badge that is simply always rendered.
    cleanup();
    open(WHEY);
    expect(screen.getByLabelText('Serving').getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByText(/No serving size/i)).toBeNull();
  });
});
