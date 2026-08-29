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
