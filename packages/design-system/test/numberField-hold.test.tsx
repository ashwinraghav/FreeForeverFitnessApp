import { useState } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NumberField } from '../src/primitives/NumberField';
import { HOLD_MS, START_MS } from '../src/primitives/useAutoRepeat';

/**
 * Held steppers, tested through the real component.
 *
 * The first version of these tests drove the hook with a bare `vi.fn()`, which
 * mocked away the only thing that broke: a held stepper fires faster than React
 * re-renders, so several repeats can run before the new `value` prop arrives.
 * Reading the prop each time computes every repeat from the same base, the
 * number sticks after two or three notches, and that is what shipped.
 *
 * Only a component that owns its value and feeds it back can see that, so these
 * drive `NumberField` itself.
 */
function Harness({ step = 2.5 }: { readonly step?: number }) {
  const [value, setValue] = useState<number | null>(0);
  return (
    <NumberField label="Weight" unit="kg" step={step} min={0} value={value} onValueChange={setValue} />
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  /*
   * jsdom implements no pointer capture at all. Without a stub the hook's
   * try/catch falls back to the no-capture path, `pointerleave` stops the
   * repeat, and the drift test below would assert the broken behaviour it
   * exists to prevent — a green test proving nothing, which is the failure mode
   * this repo keeps meeting.
   */
  Element.prototype.setPointerCapture = function setPointerCapture() {
    /* captured */
  };
  Element.prototype.releasePointerCapture = function releasePointerCapture() {
    /* released */
  };
});
afterEach(() => vi.useRealTimers());

const setup = () => {
  const view = render(<Harness />);
  return {
    plus: view.getByRole('button', { name: /increase/i }),
    minus: view.getByRole('button', { name: /decrease/i }),
    read: () => Number((view.getByRole('textbox') as HTMLInputElement).value || '0'),
  };
};

describe('holding a stepper', () => {
  it('keeps climbing well past the few notches it used to stick at', () => {
    const { plus, read } = setup();
    fireEvent.pointerDown(plus);
    act(() => void vi.advanceTimersByTime(HOLD_MS + START_MS * 6));
    // The reported failure was "only moves three increments and stops".
    expect(read()).toBeGreaterThan(3 * 2.5);
  });

  it('reaches a heavy weight in about two seconds, which is the whole point', () => {
    const { plus, read } = setup();
    fireEvent.pointerDown(plus);
    act(() => void vi.advanceTimersByTime(HOLD_MS + 2000));
    expect(read()).toBeGreaterThanOrEqual(200);
  });

  it('holds the floor when going down', () => {
    const { minus, read } = setup();
    fireEvent.pointerDown(minus);
    act(() => void vi.advanceTimersByTime(HOLD_MS + 2000));
    expect(read()).toBe(0);
  });

  it('stops dead on release', () => {
    const { plus, read } = setup();
    fireEvent.pointerDown(plus);
    act(() => void vi.advanceTimersByTime(HOLD_MS + START_MS * 3));
    fireEvent.pointerUp(plus);
    const held = read();
    act(() => void vi.advanceTimersByTime(2000));
    expect(read()).toBe(held);
  });

  it('a plain tap still moves exactly one increment', () => {
    const { plus, read } = setup();
    fireEvent.click(plus);
    expect(read()).toBe(2.5);
  });
});

describe('the mobile-only failure', () => {
  /*
   * Reported as "it only moves three increments and stops — this happens only on
   * mobile". Two causes, and the second is the one the platform difference
   * points at.
   *
   * A thumb resting on a button is never perfectly still. Without pointer
   * capture, a millimetre of drift fires `pointerleave` and the repeat stopped —
   * so a phone quit after a couple of notches while a mouse, which does not
   * wobble, held fine.
   */
  it('keeps going when the finger drifts off the button', () => {
    const { plus, read } = setup();
    fireEvent.pointerDown(plus);
    act(() => void vi.advanceTimersByTime(HOLD_MS + START_MS * 2));
    const beforeDrift = read();

    // The wobble. With capture held, this must not end the hold.
    fireEvent.pointerLeave(plus);
    act(() => void vi.advanceTimersByTime(START_MS * 4));

    expect(read()).toBeGreaterThan(beforeDrift);
  });

  it('still stops when the pointer is genuinely cancelled', () => {
    // A real interruption — an incoming call, the OS taking the gesture — must
    // end it, unlike a wobble.
    const { plus, read } = setup();
    fireEvent.pointerDown(plus);
    act(() => void vi.advanceTimersByTime(HOLD_MS + START_MS * 2));
    fireEvent.pointerCancel(plus);
    const atCancel = read();
    act(() => void vi.advanceTimersByTime(2000));
    expect(read()).toBe(atCancel);
  });
});
