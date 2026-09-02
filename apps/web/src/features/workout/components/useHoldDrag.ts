import { useCallback, useEffect, useRef, useState } from 'react';
import { vibrate } from '../timer/feedback.js';

/**
 * Hold, then drag up or down to change a number. Release sets it.
 *
 * Going 20 kg to 60 kg costs sixteen stepper taps or a trip to the keyboard.
 * One motion is better, and it is the interaction a phone volume rocker already
 * taught everyone.
 *
 * **Why a hold arms it, rather than a plain drag.** The set list lives inside an
 * `overflow-y: auto` container, so a vertical drag beginning on a cell is
 * already a scroll gesture and the browser claims it. The usual fix —
 * `touch-action: none` on the cell — works but turns a 56px target into a dead
 * zone for scrolling, and in a long session those cells are most of the screen.
 *
 * A hold sidesteps it: while the finger is still, no scroll has begun, so after
 * the threshold we can capture the pointer and take subsequent moves without
 * fighting anything. Move first and it stays a scroll, which is correct — a
 * flick down a list should never adjust a weight.
 *
 * Everything here is best-effort in the same spirit as `feedback.ts`: a thrown
 * exception inside a pointer handler takes the screen down mid-session.
 */

/** Long enough not to fire on a flick, short enough not to feel broken. */
export const ARM_MS = 160;
/** Finger travel that cancels arming — this was a scroll, not a hold. */
export const CANCEL_PX = 10;
/** Travel per increment once armed. Roughly a thumb-joint of movement. */
export const PX_PER_STEP = 18;

/** One tick as the value crosses an increment; distinct from the set-logged buzz. */
const STEP_PATTERN: readonly number[] = [8];
/** A slightly longer one the moment drag arms, so the mode change is felt. */
const ARM_PATTERN: readonly number[] = [18];

export interface HoldDrag {
  readonly armed: boolean;
  /**
   * True for exactly one call, immediately after a drag ends.
   *
   * `click` still has to open the editor — Enter, a screen reader's activate,
   * and a mouse all produce a click with no pointer sequence, so removing the
   * handler would lock keyboard users out of editing a weight entirely. But a
   * touch drag also emits a click on release, which would reopen the editor
   * over the value just set. So the click stays and this swallows the one that
   * follows a drag.
   */
  readonly consumeClickAfterDrag: () => boolean;
  /** Spread onto the element. Pointer events only — one code path for touch and mouse. */
  readonly handlers: {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  };
}

export interface HoldDragOptions {
  /** The value at the moment the drag arms. Null is treated as starting from zero. */
  readonly value: number | null;
  readonly step: number;
  readonly min?: number;
  readonly onChange: (value: number) => void;
  /** Called when a press ends without ever arming — i.e. it was a tap. */
  readonly onTap?: (() => void) | undefined;
  readonly disabled?: boolean;
}

export function useHoldDrag({
  value,
  step,
  min = 0,
  onChange,
  onTap,
  disabled = false,
}: HoldDragOptions): HoldDrag {
  const [armed, setArmed] = useState(false);
  const justDragged = useRef(false);
  const startY = useRef(0);
  const startValue = useRef(0);
  const lastValue = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // A press that outlives the component would otherwise leave a live timer.
  useEffect(() => clearTimer, [clearTimer]);

  const disarm = useCallback(() => {
    clearTimer();
    armedRef.current = false;
    setArmed(false);
  }, [clearTimer]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (disabled) return;
      startY.current = event.clientY;
      startValue.current = value ?? 0;
      lastValue.current = value ?? 0;
      timer.current = setTimeout(() => {
        armedRef.current = true;
        setArmed(true);
        vibrate(ARM_PATTERN);
        try {
          event.currentTarget?.setPointerCapture?.(event.pointerId);
        } catch {
          // Capture is an optimisation; without it moves still arrive while the
          // pointer stays over the element.
        }
      }, ARM_MS);
    },
    [disabled, value],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const dy = event.clientY - startY.current;

      if (!armedRef.current) {
        // Moved before arming: this is a scroll. Let the browser have it.
        if (Math.abs(dy) > CANCEL_PX) clearTimer();
        return;
      }

      // Up increases, which is the direction a volume rocker taught everyone.
      const steps = Math.round(-dy / PX_PER_STEP);
      const next = Math.max(min, startValue.current + steps * step);
      // Snapped to the increment, never continuous: you want 62.5, never 62.3.
      const snapped = Math.round(next / step) * step;
      if (snapped !== lastValue.current) {
        lastValue.current = snapped;
        vibrate(STEP_PATTERN);
        onChange(snapped);
      }
    },
    [clearTimer, min, onChange, step],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const wasArmed = armedRef.current;
      try {
        event.currentTarget?.releasePointerCapture?.(event.pointerId);
      } catch {
        /* nothing to release */
      }
      disarm();
      if (wasArmed) {
        // A click follows this release; mark it to be swallowed.
        justDragged.current = true;
      } else {
        // Released without ever arming — the user meant to tap. The click that
        // follows is swallowed too, so the tap is not delivered twice.
        justDragged.current = true;
        onTap?.();
      }
    },
    [disarm, onTap],
  );

  const consumeClickAfterDrag = useCallback(() => {
    if (!justDragged.current) return false;
    justDragged.current = false;
    return true;
  }, []);

  return {
    armed,
    consumeClickAfterDrag,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: disarm },
  };
}
