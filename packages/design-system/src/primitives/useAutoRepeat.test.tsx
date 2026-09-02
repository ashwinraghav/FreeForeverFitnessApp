import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GROW_AFTER, HOLD_MS, MIN_MS, START_MS, useAutoRepeat } from './useAutoRepeat';

/**
 * Holding `+` is how you get from 20 kg to 200 kg without tapping 72 times.
 * The important property is that a TAP is unaffected — the button's own click
 * is still the single-step path for mouse, touch and keyboard alike, and this
 * only ever adds repeats after a deliberate hold.
 */
function Probe({ onStep, disabled }: { readonly onStep: (m: number) => void; readonly disabled?: boolean }) {
  const repeat = useAutoRepeat(onStep, disabled ?? false);
  return (
    <button
      type="button"
      data-testid="b"
      onClick={() => {
        if (repeat.consumeTrailingClick()) return;
        onStep(0); // 0 marks "this came from a click", so tests can tell them apart
      }}
      {...repeat.handlers}
    >
      +
    </button>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = (disabled = false) => {
  const onStep = vi.fn();
  const view = render(<Probe onStep={onStep} disabled={disabled} />);
  return { el: view.getByTestId('b'), onStep };
};

describe('press and hold to keep stepping', () => {
  it('a tap steps exactly once, through the click', () => {
    const { el, onStep } = setup();
    fireEvent.pointerDown(el);
    act(() => void vi.advanceTimersByTime(HOLD_MS - 100));
    fireEvent.pointerUp(el);
    el.click();
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(onStep).toHaveBeenCalledWith(0); // the click path
  });

  it('does nothing at all before the hold threshold', () => {
    const { el, onStep } = setup();
    fireEvent.pointerDown(el);
    act(() => void vi.advanceTimersByTime(HOLD_MS - 10));
    expect(onStep).not.toHaveBeenCalled();
  });

  it('repeats once the hold is sustained', () => {
    const { el, onStep } = setup();
    fireEvent.pointerDown(el);
    act(() => void vi.advanceTimersByTime(HOLD_MS + START_MS * 2));
    expect(onStep.mock.calls.length).toBeGreaterThan(1);
  });

  it('accelerates rather than ticking at a fixed rate', () => {
    const { el, onStep } = setup();
    fireEvent.pointerDown(el);
    act(() => void vi.advanceTimersByTime(HOLD_MS + 1000));
    const early = onStep.mock.calls.length;
    act(() => void vi.advanceTimersByTime(1000));
    const late = onStep.mock.calls.length - early;
    // The same second of holding yields more steps later than earlier.
    expect(late).toBeGreaterThan(early);
  });

  it('grows the increment on a long hold, so 200 kg is reachable', () => {
    const { el, onStep } = setup();
    fireEvent.pointerDown(el);
    act(() => void vi.advanceTimersByTime(HOLD_MS + MIN_MS * GROW_AFTER * 6));
    const multipliers = onStep.mock.calls.map((c) => c[0]);
    expect(multipliers).toContain(1);
    expect(multipliers).toContain(2);
    expect(multipliers).toContain(4);
    // Capped, so a long hold does not run away into nonsense.
    expect(Math.max(...(multipliers as number[]))).toBe(4);
  });

  it('stops the moment the finger lifts', () => {
    const { el, onStep } = setup();
    fireEvent.pointerDown(el);
    act(() => void vi.advanceTimersByTime(HOLD_MS + START_MS * 2));
    fireEvent.pointerUp(el);
    const atRelease = onStep.mock.calls.length;
    act(() => void vi.advanceTimersByTime(2000));
    expect(onStep.mock.calls.length).toBe(atRelease);
  });

  it('stops if the finger slides off the button', () => {
    const { el, onStep } = setup();
    fireEvent.pointerDown(el);
    act(() => void vi.advanceTimersByTime(HOLD_MS + START_MS));
    fireEvent.pointerLeave(el);
    const atLeave = onStep.mock.calls.length;
    act(() => void vi.advanceTimersByTime(1000));
    expect(onStep.mock.calls.length).toBe(atLeave);
  });

  it('swallows the click that trails a hold, so releasing adds nothing', () => {
    const { el, onStep } = setup();
    fireEvent.pointerDown(el);
    act(() => void vi.advanceTimersByTime(HOLD_MS + START_MS * 2));
    fireEvent.pointerUp(el);
    const held = onStep.mock.calls.length;
    el.click();
    expect(onStep.mock.calls.length).toBe(held);
  });

  it('leaves a bare click alone, which is how keyboard and screen readers arrive', () => {
    // No pointer sequence at all. If this ever regresses, Enter stops working.
    const { el, onStep } = setup();
    el.click();
    expect(onStep).toHaveBeenCalledWith(0);
  });

  it('never repeats when disabled', () => {
    const { el, onStep } = setup(true);
    fireEvent.pointerDown(el);
    act(() => void vi.advanceTimersByTime(HOLD_MS + 2000));
    expect(onStep).not.toHaveBeenCalled();
  });
});
