import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { memoryWorkoutRepository } from '../storage/workoutStore.js';
import { formatClock, remainingMs, type RestTimerState } from './restTimer.js';
import { useRestTimer, type RestTimerControls } from './useRestTimer.js';

/**
 * These tests are about one claim: **the timer survives backgrounding, screen lock and
 * app kill**, and it does so because nothing counts.
 *
 * The three scenarios are simulated by the three things that actually happen:
 * advancing the wall clock with no timers firing (backgrounded), firing
 * `visibilitychange` (returning), and mounting a whole new component tree against the
 * same storage (killed and reopened).
 */

const T0 = 1_760_000_000_000;
let clock = T0;
const now = () => clock;

let controls: RestTimerControls | null = null;

function Probe({ repository }: { readonly repository: ReturnType<typeof memoryWorkoutRepository> }) {
  const timer = useRestTimer({ repository, now });
  controls = timer;
  return (
    <span data-testid="clock">
      {timer.rest === null ? 'idle' : formatClock(remainingMs(timer.rest, timer.now))}
    </span>
  );
}

const readClock = () => screen.getByTestId('clock').textContent;

beforeEach(() => {
  clock = T0;
  controls = null;
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  // Explicit even though `test/setup.ts` cleans up centrally: this file runs on fake
  // timers, and unmounting has to happen while they are still installed. The central
  // hook would otherwise run after `useRealTimers` and tear down components whose
  // intervals belong to a clock that no longer exists.
  cleanup();
  vi.useRealTimers();
});

describe('the interval is a repaint clock, not the timer', () => {
  it('shows the right number after a long gap in which no interval ever fired', () => {
    const repository = memoryWorkoutRepository();
    render(<Probe repository={repository} />);

    act(() => {
      controls?.start('x1', 's1', 120);
    });
    expect(readClock()).toBe('2:00');

    // Ninety seconds of wall clock. Deliberately no `advanceTimersByTime`: this is a
    // backgrounded tab, where the interval is throttled to nothing.
    clock = T0 + 90_000;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(readClock()).toBe('0:30');
  });

  it('resyncs on pageshow, which is the only event a restored iOS page fires', () => {
    const repository = memoryWorkoutRepository();
    render(<Probe repository={repository} />);
    act(() => {
      controls?.start('x1', 's1', 120);
    });

    clock = T0 + 60_000;
    act(() => {
      globalThis.dispatchEvent(new Event('pageshow'));
    });
    expect(readClock()).toBe('1:00');
  });

  it('repaints on its own while the app is in the foreground', () => {
    const repository = memoryWorkoutRepository();
    render(<Probe repository={repository} />);
    act(() => {
      controls?.start('x1', 's1', 120);
    });

    clock = T0 + 1_000;
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(readClock()).toBe('1:59');
  });
});

describe('surviving an app kill', () => {
  it('a whole new tree picks the timer up from storage', () => {
    const repository = memoryWorkoutRepository();
    const first = render(<Probe repository={repository} />);
    act(() => {
      controls?.start('x1', 's1', 120);
    });
    first.unmount();

    // Everything in memory is gone. Only `{ startedAt, durationSec }` remains.
    clock = T0 + 45_000;
    render(<Probe repository={repository} />);
    expect(readClock()).toBe('1:15');
  });

  it('paints the right number on the FIRST frame, not after an effect', () => {
    // Reading storage in an effect would flash "idle" at someone standing under a bar.
    const repository = memoryWorkoutRepository();
    const stored: RestTimerState = {
      startedAt: T0,
      durationSec: 120,
      exerciseId: 'x1',
      setId: 's1',
    };
    repository.saveRest(stored);

    clock = T0 + 30_000;
    render(<Probe repository={repository} />);
    expect(readClock()).toBe('1:30');
  });
});

describe('stopping', () => {
  it('returns the rest actually taken and clears storage', () => {
    const repository = memoryWorkoutRepository();
    render(<Probe repository={repository} />);
    act(() => {
      controls?.start('x1', 's1', 120);
    });

    clock = T0 + 240_000;
    let taken: number | null = null;
    act(() => {
      taken = controls?.stop() ?? null;
    });

    expect(taken).toBe(240);
    expect(repository.loadRest()).toBeNull();
    expect(readClock()).toBe('idle');
  });

  it('is null when there is nothing running', () => {
    const repository = memoryWorkoutRepository();
    render(<Probe repository={repository} />);
    expect(controls?.stop()).toBeNull();
  });
});

describe('adjusting', () => {
  it('adds time and persists it', () => {
    const repository = memoryWorkoutRepository();
    render(<Probe repository={repository} />);
    act(() => {
      controls?.start('x1', 's1', 120);
    });
    act(() => {
      controls?.adjust(30);
    });

    expect(readClock()).toBe('2:30');
    expect(repository.loadRest()?.durationSec).toBe(150);
    // The start instant is untouched, so the rest eventually logged stays truthful.
    expect(repository.loadRest()?.startedAt).toBe(T0);
  });
});

describe('the finish signal', () => {
  it('fires once when the deadline passes', () => {
    const repository = memoryWorkoutRepository();
    const onFinish = vi.fn();

    function FinishProbe() {
      const timer = useRestTimer({ repository, onFinish, now });
      controls = timer;
      return <span>{timer.rest === null ? 'idle' : 'resting'}</span>;
    }

    render(<FinishProbe />);
    act(() => {
      controls?.start('x1', 's1', 120);
    });
    expect(onFinish).not.toHaveBeenCalled();

    clock = T0 + 120_000;
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);

    // Still once, several ticks later.
    clock = T0 + 125_000;
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('does not fire for a rest that ended twenty minutes ago', () => {
    // Coming back to the app long after the fact should not buzz in the changing room.
    const repository = memoryWorkoutRepository();
    const onFinish = vi.fn();
    repository.saveRest({ startedAt: T0, durationSec: 120, exerciseId: 'x1', setId: 's1' });

    function FinishProbe() {
      const timer = useRestTimer({ repository, onFinish, now });
      return <span>{timer.rest === null ? 'idle' : 'resting'}</span>;
    }

    clock = T0 + 20 * 60_000;
    render(<FinishProbe />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onFinish).not.toHaveBeenCalled();
    // ...but it is marked done, so it stops being re-checked every tick.
    expect(repository.loadRest()?.alarmedAt).toBeDefined();
  });
});
