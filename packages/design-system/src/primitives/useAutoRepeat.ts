import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { emitDiag } from './diagSink.js';

/**
 * Press and hold a stepper to keep stepping, faster the longer you hold.
 *
 * Tapping `+` sixteen times to get from 20 kg to 60 kg is the problem this
 * solves, and holding is the interaction every spinbox and volume control has
 * used for decades — so it needs no explaining and no affordance.
 *
 * **Rate AND increment both grow.** Rate alone is not enough: 20 kg to 200 kg is
 * 72 increments of 2.5, which is several seconds even at full speed. After a
 * sustained hold the increment doubles, then doubles again, so big numbers
 * arrive in about two seconds. Because the multipliers are powers of two and the
 * base is a plate increment, every value on the way is still a real weight — you
 * pass 70, 80, 90, never 71.3.
 *
 * `onClick` on the button is left alone and remains the single-step path, so a
 * mouse click, a screen-reader activate and Enter all keep working with no
 * pointer sequence at all. This only ever *adds* repeats after a deliberate
 * hold, and suppresses the trailing click if any fired.
 */

/** Long enough that a tap is never a hold. */
export const HOLD_MS = 350;
/** First repeat interval, before acceleration. */
export const START_MS = 200;
/** Fastest it will ever go. Below this the numbers blur. */
export const MIN_MS = 35;
/** How sharply the interval shortens each tick. */
const DECAY = 0.82;
/** Repeats before the increment doubles, and again before it doubles a second time. */
export const GROW_AFTER = 20;

export interface AutoRepeat {
  readonly handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerLeave: () => void;
    onPointerCancel: () => void;
  };
  /** True if a hold produced repeats; the click that follows should be ignored. */
  readonly consumeTrailingClick: () => boolean;
}

/**
 * @param step Called for each repeat with the increment multiplier to apply.
 */
export function useAutoRepeat(step: (multiplier: number) => void, disabled = false): AutoRepeat {
  /*
   * `step` is held in a ref, refreshed every render, and `tick` reads it from
   * there rather than closing over it.
   *
   * This is not tidiness. `tick` reschedules itself with `setTimeout(tick, …)`,
   * so the running chain is whichever closure existed when the hold began. Each
   * repeat changes the value, which re-renders, which builds a NEW `step` over
   * the new value — but the chain keeps calling the old one. Every repeat after
   * the first then computes from the same stale base and lands on the same
   * number, so the control moves two or three notches and appears to jam. That
   * is exactly what shipped.
   */
  const stepRef = useRef(step);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const count = useRef(0);
  const interval = useRef(START_MS);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    stepRef.current = step;
  });

  // A press outliving the component would otherwise leave a live timer behind.
  useEffect(() => stop, [stop]);

  const tick = useCallback(() => {
    count.current += 1;
    fired.current = true;
    // Two doublings, so the increment tops out at 4x rather than running away.
    const multiplier = count.current > GROW_AFTER * 2 ? 4 : count.current > GROW_AFTER ? 2 : 1;
    emitDiag('repeat.tick', { n: count.current, multiplier, interval: Math.round(interval.current) });
    stepRef.current(multiplier);
    interval.current = Math.max(MIN_MS, interval.current * DECAY);
    timer.current = setTimeout(tick, interval.current);
    // Stable identity on purpose: the chain must not depend on a closure that
    // goes stale the instant the value it reads changes.
  }, []);

  const captured = useRef(false);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
    if (disabled) return;
    /*
     * Capture the pointer for the whole hold.
     *
     * This is the mobile-only half of the bug. A thumb resting on a button is
     * never perfectly still, and without capture a millimetre of drift fires
     * `pointerleave`, which stopped the repeat — so on a phone it moved a couple
     * of notches and quit while a mouse, which does not wobble, was fine.
     * Capture keeps every move bound to this element until release, and
     * suppresses `pointerleave` entirely while it holds.
     */
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
      captured.current = true;
      emitDiag('repeat.down', { captured: true, pointerType: event.pointerType });
    } catch {
      // Not fatal: without capture the leave handler is the safety net it
      // always was.
      captured.current = false;
      emitDiag('repeat.down', { captured: false, pointerType: event.pointerType });
    }
    // Nothing happens here for a tap: the button's own click does that single
    // step, for every input method. This only arms the repeat.
    count.current = 0;
    interval.current = START_MS;
    fired.current = false;
    timer.current = setTimeout(tick, HOLD_MS);
    },
    [disabled, tick],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (captured.current) {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          /* already gone */
        }
        captured.current = false;
      }
      stop();
    },
    [stop],
  );

  const onPointerLeave = useCallback(() => {
    emitDiag('repeat.leave', { captured: captured.current });
    // While captured this never fires. It remains the fallback for a mouse
    // dragged off the button, and for any browser that refused capture.
    if (!captured.current) stop();
  }, [stop]);

  const consumeTrailingClick = useCallback(() => {
    if (!fired.current) return false;
    fired.current = false;
    return true;
  }, []);

  return {
    handlers: {
      onPointerDown,
      onPointerUp,
      onPointerLeave,
      onPointerCancel: () => {
        // The interesting one: if a phone stops mid-hold, this is usually why.
        emitDiag('repeat.cancel');
        stop();
      },
    },
    consumeTrailingClick,
  };
}
