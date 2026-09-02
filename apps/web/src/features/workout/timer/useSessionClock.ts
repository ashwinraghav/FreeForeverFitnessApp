import { useEffect, useState } from 'react';

/** One second. The header shows seconds, so anything slower visibly stutters. */
const TICK_MS = 1000;

/**
 * A ticking wall clock for the session header.
 *
 * This exists because of a real bug: the header read `now()` during render but nothing
 * re-rendered the screen on its own, so the elapsed time only advanced as a *side effect*
 * of the rest timer's interval. Tap Done on the rest timer and the session clock froze
 * until something else happened to re-render — logging a set, opening an editor. It looked
 * intermittent rather than broken, which is why it survived so long.
 *
 * A display clock must own its own tick. Passing `Date.now` down and hoping someone else
 * re-renders is not a clock, it is a coincidence.
 *
 * `active` stops the interval once the session has ended, where `clockAt` pins the value
 * anyway and ticking would be work for nothing.
 */
export function useSessionClock(active: boolean, clock: () => number): number {
  const [now, setNow] = useState<number>(() => clock());

  useEffect(() => {
    if (!active) return undefined;

    const tick = () => setNow(clock());

    tick();
    const interval = setInterval(tick, TICK_MS);
    // Background tabs throttle `setInterval` to about once a minute, so coming back to
    // the app is its own resync signal. `pageshow` is the one that matters on iOS, where
    // a page restored from bfcache fires nothing else.
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
  }, [active, clock]);

  return now;
}
