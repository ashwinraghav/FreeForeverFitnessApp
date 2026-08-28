import { describe, expect, it } from 'vitest';

import {
  ALARM_GRACE_MS,
  adjustRest,
  announceClock,
  elapsedMs,
  formatClock,
  isFinished,
  markAlarmed,
  MAX_REST_SEC,
  MIN_REST_SEC,
  missedAlarm,
  progress,
  remainingMs,
  restTakenSec,
  shouldAlarm,
  startRest,
} from './restTimer.js';

const T0 = 1_760_000_000_000;
const timer = startRest('x1', 's1', 90, T0);

describe('the timer is arithmetic, not a countdown', () => {
  it('reads correctly the instant it starts', () => {
    expect(remainingMs(timer, T0)).toBe(90_000);
    expect(elapsedMs(timer, T0)).toBe(0);
    expect(isFinished(timer, T0)).toBe(false);
  });

  it('reads correctly at any later instant, with no ticks in between', () => {
    // This is the whole design. No interval ran; the number is still right, which is
    // exactly what happens when the tab was backgrounded or the phone was locked.
    expect(remainingMs(timer, T0 + 30_000)).toBe(60_000);
    expect(remainingMs(timer, T0 + 89_999)).toBe(1);
  });

  it('survives a reload — the state is two numbers', () => {
    // Round-tripping through JSON is exactly what the store does, and the timer is
    // unchanged by it because there was never any in-memory progress to lose.
    const revived = JSON.parse(JSON.stringify(timer)) as typeof timer;
    expect(remainingMs(revived, T0 + 45_000)).toBe(remainingMs(timer, T0 + 45_000));
  });

  it('goes negative past the deadline, because overtime is information', () => {
    expect(remainingMs(timer, T0 + 100_000)).toBe(-10_000);
    expect(isFinished(timer, T0 + 100_000)).toBe(true);
  });

  it('reports two hours of overtime rather than clamping at zero', () => {
    // The lifter who left their phone on the bench and came back needs to know the
    // rest is long over, not that it just finished.
    expect(remainingMs(timer, T0 + 7_200_000)).toBe(-7_110_000);
  });

  it('does not run backwards if the wall clock does', () => {
    expect(elapsedMs(timer, T0 - 5_000)).toBe(0);
    expect(remainingMs(timer, T0 - 5_000)).toBe(90_000);
  });
});

describe('progress', () => {
  it('runs zero to one and clamps in overtime', () => {
    expect(progress(timer, T0)).toBe(0);
    expect(progress(timer, T0 + 45_000)).toBe(0.5);
    expect(progress(timer, T0 + 90_000)).toBe(1);
    // A bar that overflows its track is a rendering bug on a screen read at a glance.
    expect(progress(timer, T0 + 900_000)).toBe(1);
  });

  it('is complete for a zero-length rest rather than dividing by zero', () => {
    expect(progress({ ...timer, durationSec: 0 }, T0)).toBe(1);
  });
});

describe('the rest that actually gets logged', () => {
  it('is measured, not prescribed', () => {
    // `restSecBefore` is "rest taken before this set, measured by the app, not
    // prescribed" — so a lifter who sat for four minutes on a 90-second timer logs 240.
    expect(restTakenSec(timer, T0 + 240_400)).toBe(240);
  });

  it('rounds to the nearest second', () => {
    expect(restTakenSec(timer, T0 + 89_500)).toBe(90);
    expect(restTakenSec(timer, T0 + 89_400)).toBe(89);
  });
});

describe('adjusting mid-rest', () => {
  it('adds time without disturbing what has already elapsed', () => {
    const longer = adjustRest(timer, 30);
    expect(longer.durationSec).toBe(120);
    expect(longer.startedAt).toBe(timer.startedAt);
    // The rest eventually logged is still the truth about how long it really was.
    expect(restTakenSec(longer, T0 + 100_000)).toBe(100);
  });

  it('takes time off', () => {
    expect(adjustRest(timer, -30).durationSec).toBe(60);
  });

  it('clamps rather than producing a negative rest', () => {
    expect(adjustRest(timer, -1000).durationSec).toBe(MIN_REST_SEC);
    expect(adjustRest(timer, 999_999).durationSec).toBe(MAX_REST_SEC);
  });

  it('re-arms the alarm when a finished timer is extended', () => {
    const done = markAlarmed(timer, T0 + 90_000);
    expect(shouldAlarm(done, T0 + 90_000)).toBe(false);
    const extended = adjustRest(done, 60);
    expect(extended.alarmedAt).toBeUndefined();
    expect(shouldAlarm(extended, T0 + 150_000)).toBe(true);
  });

  it('is a no-op when the adjustment changes nothing', () => {
    expect(adjustRest(timer, 0)).toBe(timer);
  });
});

describe('the alarm fires once, and only when it still means something', () => {
  it('does not fire before the deadline', () => {
    expect(shouldAlarm(timer, T0 + 89_000)).toBe(false);
  });

  it('fires at the deadline', () => {
    expect(shouldAlarm(timer, T0 + 90_000)).toBe(true);
  });

  it('still fires a few seconds late, which is what a resume looks like', () => {
    // The tab was backgrounded, the interval was throttled, and the first repaint
    // after coming back is four seconds past the deadline. That should still buzz.
    expect(shouldAlarm(timer, T0 + 94_000)).toBe(true);
  });

  it('does not fire twenty minutes late', () => {
    // A phone that vibrates in the changing room is a phone people mute.
    const late = T0 + 90_000 + ALARM_GRACE_MS + 1;
    expect(shouldAlarm(timer, late)).toBe(false);
    expect(missedAlarm(timer, late)).toBe(true);
  });

  it('does not fire twice', () => {
    const fired = markAlarmed(timer, T0 + 90_000);
    expect(shouldAlarm(fired, T0 + 90_100)).toBe(false);
    expect(missedAlarm(fired, T0 + 900_000)).toBe(false);
  });
});

describe('the clock, as read at arm’s length', () => {
  it('shows the full duration on the first frame', () => {
    // Rounding down here would flash "1:29" the instant the timer starts.
    expect(formatClock(90_000)).toBe('1:30');
  });

  it('pads the seconds so the digits do not jump', () => {
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(9_000)).toBe('0:09');
  });

  it('counts up in overtime with no zero flicker', () => {
    expect(formatClock(1)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-1)).toBe('-0:01');
    expect(formatClock(-11_000)).toBe('-0:11');
    expect(formatClock(-11_001)).toBe('-0:12');
    expect(formatClock(-90_000)).toBe('-1:30');
  });

  it('handles rests longer than ten minutes', () => {
    expect(formatClock(630_000)).toBe('10:30');
  });

  it('is spelled out for a screen reader, which would read 1:30 as a number', () => {
    expect(announceClock(90_000)).toBe('1 minute 30 seconds left');
    expect(announceClock(60_000)).toBe('1 minute left');
    expect(announceClock(9_000)).toBe('9 seconds left');
    expect(announceClock(-11_000)).toBe('11 seconds over');
  });
});

describe('starting a rest', () => {
  it('clamps a nonsense duration instead of storing it', () => {
    expect(startRest('x', 's', Number.NaN, T0).durationSec).toBe(120);
    expect(startRest('x', 's', -5, T0).durationSec).toBe(MIN_REST_SEC);
    expect(startRest('x', 's', 99_999, T0).durationSec).toBe(MAX_REST_SEC);
  });

  it('remembers which set it follows', () => {
    const rest = startRest('x1', 's7', 90, T0);
    expect(rest.exerciseId).toBe('x1');
    expect(rest.setId).toBe('s7');
  });
});
