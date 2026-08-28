import { useCallback, useEffect, useRef, useState } from 'react';

import type { WorkoutRepository } from '../storage/workoutStore.js';
import { signalRestDone } from './feedback.js';
import {
  adjustRest,
  markAlarmed,
  missedAlarm,
  restTakenSec,
  shouldAlarm,
  startRest,
  type RestTimerState,
} from './restTimer.js';

/**
 * The rest timer, wired to React.
 *
 * The interval below is a **repaint clock and nothing else**. It does not advance the
 * timer, accumulate anything, or matter to correctness — `restTimer.ts` derives every
 * displayed value from a stored start instant. Chrome throttles a backgrounded tab's
 * intervals to roughly once a minute, iOS suspends them entirely on lock, and killing
 * the app stops them existing. In all three cases the next paint after the app comes
 * back shows the right number, because the right number was never in memory.
 *
 * What the listeners add is *promptness*, not correctness: `visibilitychange`,
 * `pageshow` and `focus` force an immediate repaint on the way back in, so the lifter
 * does not watch a stale "1:12" for a second before it snaps to "0:04".
 */

/** Repaint cadence. Fast enough that seconds never look like they skip. */
const TICK_MS = 250;

export interface UseRestTimerOptions {
  readonly repository: Pick<WorkoutRepository, 'loadRest' | 'saveRest'>;
  /** Called once when a rest finishes and the alarm is still worth sounding. */
  readonly onFinish?: (state: RestTimerState) => void;
  /** Injectable clock, so the behaviour is testable without waiting two minutes. */
  readonly now?: () => number;
}

export interface RestTimerControls {
  readonly rest: RestTimerState | null;
  /** Repaint clock. Read this so a component re-renders as the seconds pass. */
  readonly now: number;
  start: (exerciseId: string, setId: string, durationSec: number) => void;
  /** Stop the rest and return how long it actually lasted, for `restSecBefore`. */
  stop: () => number | null;
  adjust: (deltaSec: number) => void;
}

export function useRestTimer(options: UseRestTimerOptions): RestTimerControls {
  const clock = options.now ?? Date.now;
  const { repository } = options;

  // Read straight out of storage on mount. This is the app-kill recovery path, and it
  // is a plain lazy initialiser rather than an effect so the first paint is already
  // correct rather than flashing an empty bar first.
  const [rest, setRest] = useState<RestTimerState | null>(() => repository.loadRest());
  const [now, setNow] = useState<number>(() => clock());

  // Kept in a ref so the tick effect does not need to re-subscribe every render.
  const onFinish = useRef(options.onFinish);
  onFinish.current = options.onFinish;

  const persist = useCallback(
    (next: RestTimerState | null) => {
      setRest(next);
      repository.saveRest(next);
    },
    [repository],
  );

  useEffect(() => {
    if (rest === null) return undefined;

    const tick = () => {
      const at = clock();
      setNow(at);

      if (shouldAlarm(rest, at)) {
        signalRestDone();
        onFinish.current?.(rest);
        persist(markAlarmed(rest, at));
      } else if (missedAlarm(rest, at)) {
        // The deadline passed while the phone was in a pocket for twenty minutes.
        // Mark it done silently: a buzz now is noise, and re-checking every tick is
        // work for nothing.
        persist(markAlarmed(rest, at));
      }
    };

    tick();
    const interval = setInterval(tick, TICK_MS);
    // Every one of these is a "we just came back" signal. `pageshow` is the one that
    // matters on iOS, where a restored bfcache page fires nothing else.
    const resync = () => tick();
    document.addEventListener('visibilitychange', resync);
    globalThis.addEventListener('pageshow', resync);
    globalThis.addEventListener('focus', resync);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', resync);
      globalThis.removeEventListener('pageshow', resync);
      globalThis.removeEventListener('focus', resync);
    };
  }, [rest, clock, persist]);

  const start = useCallback(
    (exerciseId: string, setId: string, durationSec: number) => {
      persist(startRest(exerciseId, setId, durationSec, clock()));
    },
    [persist, clock],
  );

  const stop = useCallback((): number | null => {
    if (rest === null) return null;
    const taken = restTakenSec(rest, clock());
    persist(null);
    return taken;
  }, [rest, persist, clock]);

  const adjust = useCallback(
    (deltaSec: number) => {
      if (rest === null) return;
      persist(adjustRest(rest, deltaSec));
    },
    [rest, persist],
  );

  return { rest, now, start, stop, adjust };
}
