import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARM_MS, CANCEL_PX, PX_PER_STEP, useHoldDrag, type HoldDragOptions } from './useHoldDrag';

/**
 * The gesture exists because 20 kg to 60 kg is sixteen stepper taps. The hold is
 * not decoration: the set list scrolls vertically, so a drag that begins
 * immediately is a scroll and the browser owns it. Holding still means no scroll
 * has started, which is the only moment the gesture can be claimed without
 * turning the cell into a dead zone for scrolling.
 */

function Probe(props: Omit<HoldDragOptions, 'onChange'> & { readonly onChange: (v: number) => void }) {
  const drag = useHoldDrag(props);
  return (
    <button
      type="button"
      data-testid="cell"
      data-armed={drag.armed ? 'true' : 'false'}
      onClick={() => {
        if (drag.consumeClickAfterDrag()) return;
        props.onTap?.();
      }}
      {...drag.handlers}
    >
      cell
    </button>
  );
}

const pointer = (el: Element, type: string, clientY: number) => {
  const event = new MouseEvent(type, { bubbles: true, clientY });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  el.dispatchEvent(event);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(over: Partial<HoldDragOptions> = {}) {
  const onChange = vi.fn();
  const onTap = vi.fn();
  const view = render(
    <Probe value={20} step={2.5} onChange={onChange} onTap={onTap} {...over} />,
  );
  return { cell: view.getByTestId('cell'), onChange, onTap };
}

describe('hold, then drag', () => {
  it('does not arm before the hold has elapsed', () => {
    const { cell } = setup();
    pointer(cell, 'pointerdown', 100);
    act(() => void vi.advanceTimersByTime(ARM_MS - 20));
    expect(cell.dataset['armed']).toBe('false');
  });

  it('arms once the finger has been still long enough', () => {
    const { cell } = setup();
    pointer(cell, 'pointerdown', 100);
    act(() => void vi.advanceTimersByTime(ARM_MS + 5));
    expect(cell.dataset['armed']).toBe('true');
  });

  it('never arms if the finger moved first, because that was a scroll', () => {
    // The whole reason for the hold. A flick down the set list must not adjust a
    // weight on the way past.
    const { cell, onChange } = setup();
    pointer(cell, 'pointerdown', 100);
    pointer(cell, 'pointermove', 100 - (CANCEL_PX + 5));
    act(() => void vi.advanceTimersByTime(ARM_MS + 50));
    expect(cell.dataset['armed']).toBe('false');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('increases upward, the way a volume rocker taught everyone', () => {
    const { cell, onChange } = setup();
    pointer(cell, 'pointerdown', 300);
    act(() => void vi.advanceTimersByTime(ARM_MS + 5));
    pointer(cell, 'pointermove', 300 - PX_PER_STEP * 2); // up two notches
    expect(onChange).toHaveBeenLastCalledWith(25); // 20 + 2 x 2.5
  });

  it('decreases downward', () => {
    const { cell, onChange } = setup();
    pointer(cell, 'pointerdown', 300);
    act(() => void vi.advanceTimersByTime(ARM_MS + 5));
    pointer(cell, 'pointermove', 300 + PX_PER_STEP * 2);
    expect(onChange).toHaveBeenLastCalledWith(15);
  });

  it('snaps to the plate increment — you want 62.5, never 62.3', () => {
    const { cell, onChange } = setup({ value: 60 });
    pointer(cell, 'pointerdown', 300);
    act(() => void vi.advanceTimersByTime(ARM_MS + 5));
    pointer(cell, 'pointermove', 300 - PX_PER_STEP);
    for (const call of onChange.mock.calls) {
      expect((call[0] as number) % 2.5).toBe(0);
    }
  });

  it('will not drag below the floor', () => {
    const { cell, onChange } = setup({ value: 2.5 });
    pointer(cell, 'pointerdown', 300);
    act(() => void vi.advanceTimersByTime(ARM_MS + 5));
    pointer(cell, 'pointermove', 300 + PX_PER_STEP * 10);
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('emits once per increment, not once per pixel', () => {
    const { cell, onChange } = setup();
    pointer(cell, 'pointerdown', 300);
    act(() => void vi.advanceTimersByTime(ARM_MS + 5));
    // Three moves that all land inside the same notch.
    pointer(cell, 'pointermove', 296);
    pointer(cell, 'pointermove', 295);
    pointer(cell, 'pointermove', 294);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a short press is still a tap', () => {
    const { cell, onTap } = setup();
    pointer(cell, 'pointerdown', 100);
    act(() => void vi.advanceTimersByTime(ARM_MS - 40));
    pointer(cell, 'pointerup', 100);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('a drag is not also a tap', () => {
    const { cell, onTap } = setup();
    pointer(cell, 'pointerdown', 300);
    act(() => void vi.advanceTimersByTime(ARM_MS + 5));
    pointer(cell, 'pointermove', 300 - PX_PER_STEP * 3);
    pointer(cell, 'pointerup', 300 - PX_PER_STEP * 3);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('a keyboard activation still works, with no pointer sequence at all', () => {
    // The regression this nearly shipped with: Enter and a screen reader's
    // activate produce a bare `click`. A pointer-only tap locks them out of
    // editing a weight entirely.
    const { cell, onTap } = setup();
    cell.click();
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all when disabled', () => {
    const { cell, onChange } = setup({ disabled: true });
    pointer(cell, 'pointerdown', 300);
    act(() => void vi.advanceTimersByTime(ARM_MS + 50));
    expect(cell.dataset['armed']).toBe('false');
    pointer(cell, 'pointermove', 300 - PX_PER_STEP * 3);
    expect(onChange).not.toHaveBeenCalled();
  });
});
