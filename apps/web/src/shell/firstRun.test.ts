import { describe, expect, it } from 'vitest';
import { hasUsedTheAppBefore } from './firstRun';

const fake = (keys: readonly string[]): Storage =>
  ({
    length: keys.length,
    key: (i: number) => keys[i] ?? null,
  }) as unknown as Storage;

const throwing = (): Storage =>
  ({
    get length(): number {
      throw new DOMException('denied', 'SecurityError');
    },
    key: () => null,
  }) as unknown as Storage;

describe('hasUsedTheAppBefore', () => {
  it('is false on a genuinely empty storage, so a newcomer gets the explainer', () => {
    expect(hasUsedTheAppBefore(fake([]))).toBe(false);
  });

  it('is true once the app has written anything of its own', () => {
    expect(hasUsedTheAppBefore(fake(['ff.workout.history.v1']))).toBe(true);
  });

  it('ignores keys belonging to something else on the same origin', () => {
    expect(hasUsedTheAppBefore(fake(['some-other-app:state', 'theme']))).toBe(false);
  });

  it('treats unreadable storage as "been here before" rather than greeting a locked-down browser with an explainer', () => {
    expect(hasUsedTheAppBefore(throwing())).toBe(true);
    expect(hasUsedTheAppBefore(null)).toBe(true);
  });
});

describe('every prefix convention actually in use counts as prior use', () => {
  /*
   * These are the real keys, copied from a browser after using the app — not
   * invented shapes. `ff.` alone missed two of the three, so a user who had only
   * ever logged food was sent to the explainer on every launch.
   */
  const REAL_KEYS = [
    'ff.workout.history.v1',
    'ff.workout.active.v1',
    'ff:nutrition:v1',
    'ff:localdata',
  ];

  for (const key of REAL_KEYS) {
    it(`treats ${key} as prior use`, () => {
      expect(hasUsedTheAppBefore(fake([key]))).toBe(true);
    });
  }

  it('still treats an unrelated key as a first run', () => {
    expect(hasUsedTheAppBefore(fake(['some-other-app', 'theme']))).toBe(false);
  });

  it('does not match a key that merely starts with ff', () => {
    // `ffmpeg-settings` is not ours. The separator is what makes the prefix ours.
    expect(hasUsedTheAppBefore(fake(['ffmpeg-settings']))).toBe(false);
  });
});
