import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_DATA_CHANGED_EVENT,
  WORKOUT_HISTORY_KEY,
  createLocalInsightsSource,
  notifyLocalDataChanged,
} from '../insightsSource';
import { SESSION_1, SESSIONS, historyBlob } from './fixtures';

/**
 * A Progress tab that only updates on a full reload is barely better than an empty
 * one, so every path that can deliver new data is exercised here rather than assumed.
 *
 * `storage` covers another tab. The custom event covers a same-tab writer that opts
 * in. Neither covers the case that actually happens today — the workout feature
 * writes with no announcement at all and the user then taps Progress — so the third
 * test is the important one: `read()` re-validates against the raw key and folds
 * again on its own.
 */

const NOW = () => new Date('2026-08-13T09:00:00Z');

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

function source() {
  return createLocalInsightsSource({ now: NOW, timeZone: 'Europe/London' });
}

describe('staying current', () => {
  it('picks up a same-tab write with no event at all', () => {
    const store = source();
    expect(store.read().trainingVolume?.weeks).toEqual([]);

    window.localStorage.setItem(WORKOUT_HISTORY_KEY, historyBlob());

    expect(store.read().trainingVolume?.weeks[0]?.volumeKg).toBe(3350);
    expect(store.read().adherence?.trainingStreak.currentDays).toBe(3);
  });

  it('notifies subscribers when another tab writes a session', () => {
    const store = source();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.read();

    window.localStorage.setItem(WORKOUT_HISTORY_KEY, historyBlob());
    window.dispatchEvent(new StorageEvent('storage', { key: WORKOUT_HISTORY_KEY }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.read().trainingVolume?.weeks[0]?.sessionCount).toBe(3);
    unsubscribe();
  });

  it('notifies subscribers on a same-tab announcement', () => {
    const store = source();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.read();

    window.localStorage.setItem(WORKOUT_HISTORY_KEY, historyBlob([SESSION_1]));
    notifyLocalDataChanged();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.read().trainingVolume?.weeks[0]?.volumeKg).toBe(1000);

    // …and again when a second session lands.
    window.localStorage.setItem(WORKOUT_HISTORY_KEY, historyBlob(SESSIONS));
    notifyLocalDataChanged();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.read().trainingVolume?.weeks[0]?.volumeKg).toBe(3350);
    unsubscribe();
  });

  it('stays quiet when an unrelated key changes', () => {
    window.localStorage.setItem(WORKOUT_HISTORY_KEY, historyBlob());
    const store = source();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const before = store.read();

    window.localStorage.setItem('ff:something:else', 'x');
    window.dispatchEvent(new StorageEvent('storage', { key: 'ff:something:else' }));

    expect(listener).not.toHaveBeenCalled();
    expect(store.read()).toBe(before);
    unsubscribe();
  });

  it('stops listening once the last subscriber leaves', () => {
    const store = source();
    const listener = vi.fn();
    store.subscribe(listener)();

    window.localStorage.setItem(WORKOUT_HISTORY_KEY, historyBlob());
    window.dispatchEvent(new StorageEvent('storage', { key: WORKOUT_HISTORY_KEY }));
    window.dispatchEvent(new Event(LOCAL_DATA_CHANGED_EVENT));

    expect(listener).not.toHaveBeenCalled();
  });
});
